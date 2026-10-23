import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import type { Config } from './config.js';
import { registerAuth } from './auth.js';
import { createVault } from './crypto.js';
import { readSecrets } from './init/secrets.js';
import {
  applyConnections,
  safeReadSecrets,
  type Connections,
  type ServiceKey,
} from './connections.js';
import type { Effective } from './plan/ctx.js';
import { SeerrClient } from './reconcile/seerr.js';
import { z } from 'zod';
import { buildCtx } from './plan/ctx.js';
import {
  getActivity,
  getCalendar,
  getLibrary,
  getRequests,
  getSystem,
  search,
} from './media/data.js';
import {
  addIndexer,
  listIndexers,
  removeIndexer,
  setIndexerEnabled,
  testIndexer,
} from './media/indexers.js';
import { readRequestedQuality, readSyncStatus } from './quality/recyclarr.js';
import { listBackups, runBackups } from './media/backups.js';
import { exportYaml, importYaml } from './plan/portable.js';
import { deriveDesired, diffLeaves } from './adopt.js';
import { SERVICE_KEYS } from './connections.js';
import { ArrClient } from './reconcile/arr.js';
import { BazarrClient } from './reconcile/bazarr.js';
import { QbitClient } from './reconcile/qbit.js';
import { createPlanService } from './plan/service.js';
import { checkHardlink } from './storage/hardlink.js';
import { createReconciler } from './reconcile/run.js';
import { probeAll, serviceDefs } from './services.js';

const connectionSchema = z.object({
  url: z
    .string()
    .url()
    .refine((u) => /^https?:\/\//.test(u), 'o URL tem de ser http(s)'),
  key: z.string().min(1),
  username: z.string().optional(),
});
export const adoptSchema = z.object({
  // partialRecord: o utilizador só liga os serviços que tem (o Seerr, por ex., é opcional).
  services: z.partialRecord(z.enum(SERVICE_KEYS as [string, ...string[]]), connectionSchema),
});

const jellyfinSchema = z.object({
  hostname: z.string().min(1),
  port: z.number().int().min(1).max(65535).default(8096),
  useSsl: z.boolean().default(false),
  urlBase: z.string().optional(),
  username: z.string().min(1),
  password: z.string().min(1),
  email: z.string().email().optional(),
});

export async function buildApp(config: Config, fetchImpl?: typeof fetch) {
  const app = Fastify({ logger: true });
  // Aceita POST com corpo JSON vazio (ações sem parâmetros).
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    try {
      done(null, body ? JSON.parse(body as string) : {});
    } catch (err) {
      done(err as Error);
    }
  });

  const planner = createPlanService(
    config,
    undefined,
    fetchImpl,
    () => seerrKey(),
    (name) => thirdPartySecret(name),
    () => effective(),
  );
  // Cofre: chave derivada de MEDIASTACK_SECRET (env) ou do segredo gerado pelo init.
  const vault = () =>
    createVault(
      process.env.MEDIASTACK_SECRET ??
        readSecrets(config.MEDIASTACK_SECRETS_DIR)['mediastack.secret'],
    );
  const SEERR_KEY = 'seerr.apikey';
  const thirdPartySecret = (name: string) => {
    const blob = planner.store.getSecret(name);
    return blob ? vault().decrypt(blob) : undefined;
  };
  // Modo importar: ligações a serviços já existentes (cifradas) sobrepõem os do compose.
  const connections = (): Connections => {
    const out: Connections = {};
    for (const r of planner.store.listConnections()) {
      out[r.service as ServiceKey] = {
        url: r.url,
        key: vault().decrypt(r.secret),
        username: r.username ?? undefined,
      };
    }
    return out;
  };
  const effective = (): Effective =>
    applyConnections(config, safeReadSecrets(config.MEDIASTACK_SECRETS_DIR), connections());
  const isExternal = () => planner.store.listConnections().length > 0;
  const seerrKey = () => {
    const external = planner.store.listConnections().find((r) => r.service === 'seerr');
    if (external) return vault().decrypt(external.secret);
    const blob = planner.store.getSecret(SEERR_KEY);
    return blob ? vault().decrypt(blob) : undefined;
  };
  const reconciler = createReconciler(config, fetchImpl, seerrKey, effective, isExternal);
  app.get('/api/seerr', async () => ({
    initialized: await new SeerrClient(
      config.MEDIASTACK_SEERR_URL,
      null,
      fetchImpl,
    ).isInitialized(),
    linked: seerrKey() !== undefined,
  }));
  // Completa o setup do Seerr com o admin do Jellyfin (as credenciais não são guardadas).
  app.post('/api/seerr/setup', async (req, reply) => {
    const parsed = jellyfinSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message });
    const seerr = new SeerrClient(config.MEDIASTACK_SEERR_URL, null, fetchImpl);
    try {
      if (await seerr.isInitialized()) {
        return reply.code(409).send({ error: 'o Seerr já está inicializado' });
      }
      planner.store.putSecret(
        SEERR_KEY,
        vault().encrypt(await seerr.setupWithJellyfin(parsed.data)),
      );
    } catch (err) {
      return reply.code(502).send({ error: failure(err) });
    }
    return reconciler.run();
  });
  // --- Dados agregados para a UI ---
  const ctx = () => buildCtx(effective(), fetchImpl, seerrKey(), thirdPartySecret);
  const seerrOr503 = (reply: import('fastify').FastifyReply) => {
    const k = seerrKey();
    if (!k) void reply.code(503).send({ error: 'o Seerr ainda não está ligado ao Jellyfin' });
    return k ? new SeerrClient(config.MEDIASTACK_SEERR_URL, k, fetchImpl) : null;
  };
  app.get('/api/activity', async () => getActivity(ctx()));
  app.post('/api/activity/:hash/:action', async (req, reply) => {
    const { hash, action } = req.params as { hash: string; action: string };
    if (!/^[0-9a-f]{40,64}$/i.test(hash) || !['pause', 'resume', 'delete'].includes(action)) {
      return reply.code(400).send({ error: 'pedido inválido' });
    }
    await ctx().qbit.torrentAction(action as 'pause' | 'resume' | 'delete', hash);
    return { ok: true };
  });
  const indexerId = (req: { params: unknown }) => Number((req.params as { id: string }).id);
  app.get('/api/indexers', async () => listIndexers(ctx().prowlarr));
  app.post('/api/indexers', async (req, reply) => {
    const { definitionName } = (req.body ?? {}) as { definitionName?: string };
    if (!definitionName) return reply.code(400).send({ error: 'definitionName obrigatório' });
    try {
      return await addIndexer(ctx().prowlarr, definitionName);
    } catch (err) {
      return reply.code(400).send({ error: failure(err) });
    }
  });
  app.post('/api/indexers/:id/enabled', async (req, reply) => {
    const id = indexerId(req);
    const { enable } = (req.body ?? {}) as { enable?: boolean };
    if (!Number.isInteger(id) || typeof enable !== 'boolean') {
      return reply.code(400).send({ error: 'pedido inválido' });
    }
    await setIndexerEnabled(ctx().prowlarr, id, enable);
    return { ok: true };
  });
  app.post('/api/indexers/:id/test', async (req, reply) => {
    const id = indexerId(req);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: 'pedido inválido' });
    return testIndexer(ctx().prowlarr, id);
  });
  app.delete('/api/indexers/:id', async (req, reply) => {
    const id = indexerId(req);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: 'pedido inválido' });
    await removeIndexer(ctx().prowlarr, id);
    return { ok: true };
  });
  // Estado da sincronização TRaSH (Recyclarr).
  app.get('/api/quality', async () => ({
    requested: readRequestedQuality(config.MEDIASTACK_RECYCLARR_DIR),
    sync: readSyncStatus(config.MEDIASTACK_RECYCLARR_DIR),
  }));
  // Exportar / importar o estado desejado (YAML). Segredos só se pedido, e sempre cifrados.
  app.get('/api/export', async (req, reply) => {
    const withSecrets = (req.query as { secrets?: string }).secrets === '1';
    void reply
      .type('text/yaml; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="mediastack-config.yaml"');
    return exportYaml(planner.getDesired(), withSecrets ? planner.store.listSecrets() : undefined);
  });
  app.post('/api/import', async (req, reply) => {
    const { yaml, secrets } = (req.body ?? {}) as { yaml?: string; secrets?: boolean };
    if (typeof yaml !== 'string' || !yaml.trim()) {
      return reply.code(400).send({ error: 'yaml obrigatório' });
    }
    try {
      const imported = importYaml(yaml);
      planner.setDesired(imported.desired);
      if (secrets) {
        for (const [name, blob] of Object.entries(imported.secrets))
          planner.store.putSecret(name, blob);
      }
      return {
        desired: imported.desired,
        secretsImported: secrets ? Object.keys(imported.secrets).length : 0,
      };
    } catch (err) {
      return reply.code(400).send({ error: failure(err) });
    }
  });
  // Notificações: o segredo (webhook/token) nunca passa pelo estado desejado nem é devolvido.
  app.get('/api/notifications', async () => ({
    hasSecret: planner.store.getSecret('notifications.secret') !== undefined,
  }));
  app.put('/api/notifications/secret', async (req, reply) => {
    const { value } = (req.body ?? {}) as { value?: string };
    if (typeof value !== 'string' || !value.trim() || value.length > 500) {
      return reply.code(400).send({ error: 'segredo inválido' });
    }
    planner.store.putSecret('notifications.secret', vault().encrypt(value.trim()));
    // Aplica já só as notificações, para o novo segredo chegar aos serviços.
    return planner.apply('ui', [
      'sonarr.notification',
      'radarr.notification',
      'prowlarr.notification',
    ]);
  });
  app.post('/api/notifications/test', async (_req, reply) => {
    const c = ctx();
    const found = (await c.sonarr.get<{ name: string }[]>('notification')).find(
      (n) => n.name === 'MediaStack',
    );
    if (!found) return reply.code(400).send({ error: 'as notificações ainda não estão aplicadas' });
    try {
      await c.sonarr.request('POST', 'notification/test', found);
      return { ok: true };
    } catch (err) {
      return { ok: false, message: failure(err) };
    }
  });
  app.get('/api/backups', async () => listBackups(ctx()));
  app.post('/api/backups/run', async () => runBackups(ctx()));
  app.get('/api/calendar', async () => getCalendar(ctx()));
  app.get('/api/library', async () => getLibrary(ctx()));
  app.get('/api/system', async () => getSystem(ctx(), config));
  app.get('/api/requests', async (_req, reply) => {
    const s = seerrOr503(reply);
    return s ? getRequests(s) : reply;
  });
  app.post('/api/requests/:id/approve', async (req, reply) => {
    const s = seerrOr503(reply);
    const id = Number((req.params as { id: string }).id);
    if (!s || !Number.isInteger(id)) return reply;
    return s.post(`request/${id}/approve`);
  });
  app.get('/api/search', async (req, reply) => {
    const q = String((req.query as { q?: string }).q ?? '').trim();
    const s = seerrOr503(reply);
    if (!s) return reply;
    return q ? search(s, q) : [];
  });
  app.post('/api/request', async (req, reply) => {
    const s = seerrOr503(reply);
    const b = req.body as { mediaType?: string; tmdbId?: number };
    if (!s) return reply;
    if ((b.mediaType !== 'movie' && b.mediaType !== 'tv') || !Number.isInteger(b.tmdbId)) {
      return reply.code(400).send({ error: 'mediaType/tmdbId inválidos' });
    }
    // Séries: todas as temporadas; o Seerr resolve o resto com os defaults do Sonarr/Radarr.
    return s.post('request', {
      mediaType: b.mediaType,
      mediaId: b.tmdbId,
      ...(b.mediaType === 'tv' ? { seasons: 'all' } : {}),
    });
  });

  // Entradas definidas de um `partialRecord` (os valores podem vir `undefined`).
  const definedEntries = <T>(o: Partial<Record<string, T>>) =>
    Object.entries(o).flatMap(([k, v]) => (v === undefined ? [] : [[k, v] as const]));
  // --- Modo importar: ligar a serviços já existentes sem alterar nada ---
  async function testConnection(
    service: string,
    c: { url: string; key: string; username?: string },
  ): Promise<{ service: string; ok: boolean; version?: string; error?: string }> {
    const url = c.url.replace(/\/+$/, '');
    try {
      if (service === 'sonarr' || service === 'radarr' || service === 'prowlarr') {
        const client = new ArrClient(
          service,
          url,
          c.key,
          service === 'prowlarr' ? 'v1' : 'v3',
          fetchImpl,
        );
        const st = await client.get<{ version?: string }>('system/status');
        return { service, ok: true, version: st.version };
      }
      if (service === 'bazarr') {
        await new BazarrClient(url, c.key, fetchImpl).getSettings();
        return { service, ok: true };
      }
      if (service === 'qbittorrent') {
        const prefs = await new QbitClient(url, c.username ?? 'admin', c.key, fetchImpl).getPrefs();
        return { service, ok: prefs !== undefined };
      }
      await new SeerrClient(url, c.key, fetchImpl).get('settings/main');
      return { service, ok: true };
    } catch (err) {
      return { service, ok: false, error: failure(err) };
    }
  }
  app.get('/api/adopt', async () => ({
    external: isExternal(),
    connections: Object.fromEntries(
      planner.store.listConnections().map((r) => [r.service, { url: r.url, username: r.username }]),
    ),
  }));
  app.post('/api/adopt/test', async (req, reply) => {
    const parsed = adoptSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message });
    return Promise.all(definedEntries(parsed.data.services).map(([k, c]) => testConnection(k, c)));
  });
  app.post('/api/adopt/connect', async (req, reply) => {
    const parsed = adoptSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message });
    const results = await Promise.all(
      definedEntries(parsed.data.services).map(([k, c]) => testConnection(k, c)),
    );
    // Só guarda se todas as ligações funcionarem (nunca um estado a meio).
    if (results.some((r) => !r.ok))
      return reply.code(400).send({ error: 'ligação falhou', results });
    for (const [service, c] of definedEntries(parsed.data.services)) {
      planner.store.putConnection(service, c.url, c.username ?? null, vault().encrypt(c.key));
    }
    return { results };
  });
  app.get('/api/adopt/preview', async () => {
    const derived = await deriveDesired(ctx());
    return {
      desired: derived.desired,
      notes: derived.notes,
      changes: diffLeaves(planner.getDesired(), derived.desired),
    };
  });
  // Aceitar grava o estado derivado como desejado; nada é aplicado até haver um apply.
  app.post('/api/adopt/accept', async () => {
    const derived = await deriveDesired(ctx());
    planner.setDesired(derived.desired);
    return derived;
  });
  app.delete('/api/adopt', async () => {
    planner.store.clearConnections();
    return { ok: true };
  });

  app.get('/api/reconcile', async () => reconciler.state);
  app.post('/api/reconcile', async () => reconciler.run());
  app.decorate('reconciler', reconciler);

  app.decorate('planner', planner);
  await registerAuth(app, planner.store);
  const failure = (err: unknown) => (err instanceof Error ? err.message : String(err));
  app.get('/api/desired', async () => planner.getDesired());
  app.put('/api/desired', async (req, reply) => {
    try {
      return planner.setDesired(req.body);
    } catch (err) {
      return reply.code(400).send({ error: failure(err) });
    }
  });
  // Verifica se downloads e bibliotecas estão no mesmo volume (hardlinks / moves atómicos).
  app.post('/api/storage/hardlink-check', async () => {
    const d = planner.getDesired();
    const targets = [d.storage.tvRoot, d.storage.moviesRoot];
    return Promise.all(
      targets.map(async (to) => ({
        from: d.downloads.torrentsRoot,
        to,
        ...(await checkHardlink(d.downloads.torrentsRoot, to)),
      })),
    );
  });
  app.get('/api/plan', async () => planner.plan());
  app.post('/api/apply', async (req) => {
    const only = (req.body as { only?: string[] } | null)?.only;
    return planner.apply('ui', only);
  });
  app.get('/api/audit', async () => planner.store.listAudit());
  app.get('/api/drift', async () => (await planner.checkDrift()) ?? { changes: [], errors: [] });
  app.post('/api/drift/adopt', async (req, reply) => {
    const { fieldId } = (req.body ?? {}) as { fieldId?: string };
    if (!fieldId) return reply.code(400).send({ error: 'fieldId obrigatório' });
    return planner.adopt(fieldId);
  });

  app.get('/healthz', async () => ({ ok: true }));
  app.get('/api/status', async () => ({
    services: await probeAll(serviceDefs(effective().config), fetchImpl),
  }));

  const webDir = resolve(config.MEDIASTACK_WEB_DIR);
  if (existsSync(webDir)) {
    await app.register(fastifyStatic, { root: webDir });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not_found' });
      return reply.sendFile('index.html');
    });
  }
  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    reconciler: ReturnType<typeof createReconciler>;
    planner: ReturnType<typeof createPlanService>;
  }
}

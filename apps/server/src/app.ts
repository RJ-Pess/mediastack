import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import type { Config } from './config.js';
import { registerAuth } from './auth.js';
import { createVault } from './crypto.js';
import { readSecrets } from './init/secrets.js';
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
import { createPlanService } from './plan/service.js';
import { checkHardlink } from './storage/hardlink.js';
import { createReconciler } from './reconcile/run.js';
import { probeAll, serviceDefs } from './services.js';

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
  const defs = serviceDefs(config);
  // Aceita POST com corpo JSON vazio (ações sem parâmetros).
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    try {
      done(null, body ? JSON.parse(body as string) : {});
    } catch (err) {
      done(err as Error);
    }
  });

  const planner = createPlanService(config, undefined, fetchImpl);
  // Cofre: chave derivada de CAIS_SECRET (env) ou do segredo gerado pelo init.
  const vault = () =>
    createVault(process.env.CAIS_SECRET ?? readSecrets(config.CAIS_SECRETS_DIR)['cais.secret']);
  const SEERR_KEY = 'seerr.apikey';
  const seerrKey = () => {
    const blob = planner.store.getSecret(SEERR_KEY);
    return blob ? vault().decrypt(blob) : undefined;
  };
  const reconciler = createReconciler(config, fetchImpl, seerrKey);
  app.get('/api/seerr', async () => ({
    initialized: await new SeerrClient(config.CAIS_SEERR_URL, null, fetchImpl).isInitialized(),
    linked: seerrKey() !== undefined,
  }));
  // Completa o setup do Seerr com o admin do Jellyfin (as credenciais não são guardadas).
  app.post('/api/seerr/setup', async (req, reply) => {
    const parsed = jellyfinSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message });
    const seerr = new SeerrClient(config.CAIS_SEERR_URL, null, fetchImpl);
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
  const ctx = () => buildCtx(config, fetchImpl);
  const seerrOr503 = (reply: import('fastify').FastifyReply) => {
    const k = seerrKey();
    if (!k) void reply.code(503).send({ error: 'o Seerr ainda não está ligado ao Jellyfin' });
    return k ? new SeerrClient(config.CAIS_SEERR_URL, k, fetchImpl) : null;
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
  app.get('/api/status', async () => ({ services: await probeAll(defs, fetchImpl) }));

  const webDir = resolve(config.CAIS_WEB_DIR);
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

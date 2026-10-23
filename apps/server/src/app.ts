import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import type { Config } from './config.js';
import { createPlanService } from './plan/service.js';
import { createReconciler } from './reconcile/run.js';
import { probeAll, serviceDefs } from './services.js';

export async function buildApp(config: Config, fetchImpl?: typeof fetch) {
  const app = Fastify({ logger: true });
  const defs = serviceDefs(config);

  const reconciler = createReconciler(config, fetchImpl);
  app.get('/api/reconcile', async () => reconciler.state);
  app.post('/api/reconcile', async () => reconciler.run());
  app.decorate('reconciler', reconciler);

  const planner = createPlanService(config, undefined, fetchImpl);
  app.decorate('planner', planner);
  const failure = (err: unknown) => (err instanceof Error ? err.message : String(err));
  app.get('/api/desired', async () => planner.getDesired());
  app.put('/api/desired', async (req, reply) => {
    try {
      return planner.setDesired(req.body);
    } catch (err) {
      return reply.code(400).send({ error: failure(err) });
    }
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

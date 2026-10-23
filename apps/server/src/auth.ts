import { createHash, randomBytes } from 'node:crypto';
import cookie from '@fastify/cookie';
import { hash, verify } from '@node-rs/argon2';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Store } from './plan/db.js';

const COOKIE = 'cais_session';
const SESSION_MS = 30 * 24 * 3600 * 1000;
// argon2id (algorithm: 2) com os parâmetros recomendados pela OWASP.
const ARGON = { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

const credentials = z.object({
  username: z.string().trim().min(3).max(64),
  password: z.string().min(10, 'a password precisa de pelo menos 10 caracteres').max(256),
});

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export async function registerAuth(app: FastifyInstance, store: Store): Promise<void> {
  await app.register(cookie);
  const failures = new Map<string, { n: number; until: number }>();

  async function startSession(reply: import('fastify').FastifyReply, userId: number) {
    const token = randomBytes(32).toString('base64url');
    store.createSession(sha256(token), userId, Date.now() + SESSION_MS);
    reply.setCookie(COOKIE, token, {
      httpOnly: true,
      sameSite: 'strict',
      path: '/',
      maxAge: SESSION_MS / 1000,
    });
  }

  const currentUser = (token: string | undefined) =>
    token ? store.sessionUser(sha256(token)) : undefined;

  // Tudo em /api (exceto /api/auth) exige sessão.
  app.addHook('onRequest', async (req, reply) => {
    const path = req.url.split('?')[0]!;
    if (!path.startsWith('/api/') || path.startsWith('/api/auth/')) return;
    if (!currentUser(req.cookies[COOKIE]))
      return reply.code(401).send({ error: 'não autenticado' });
  });

  app.get('/api/auth/me', async (req) => {
    const u = currentUser(req.cookies[COOKIE]);
    return { configured: store.userCount() > 0, user: u?.username ?? null };
  });

  // Só funciona enquanto não existir nenhum utilizador (primeiro passo do wizard).
  app.post('/api/auth/setup', async (req, reply) => {
    if (store.userCount() > 0) return reply.code(409).send({ error: 'já configurado' });
    const parsed = credentials.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message });
    const id = store.createUser(parsed.data.username, await hash(parsed.data.password, ARGON));
    await startSession(reply, id);
    return { user: parsed.data.username };
  });

  app.post('/api/auth/login', async (req, reply) => {
    const parsed = credentials.safeParse(req.body);
    const key = req.ip;
    const f = failures.get(key);
    if (f && f.n >= 5 && f.until > Date.now()) {
      return reply.code(429).send({ error: 'demasiadas tentativas, tenta mais tarde' });
    }
    const user = parsed.success ? store.findUser(parsed.data.username) : undefined;
    const ok = user && parsed.success && (await verify(user.passwordHash, parsed.data.password));
    if (!ok) {
      failures.set(key, { n: (f?.n ?? 0) + 1, until: Date.now() + 5 * 60_000 });
      return reply.code(401).send({ error: 'credenciais inválidas' });
    }
    failures.delete(key);
    await startSession(reply, user.id);
    return { user: user && parsed.data.username };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const t = req.cookies[COOKIE];
    if (t) store.deleteSession(sha256(t));
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });
}

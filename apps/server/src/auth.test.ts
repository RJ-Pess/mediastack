import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createVault } from './crypto.js';

const newApp = () =>
  buildApp(
    loadConfig({
      CAIS_DATA_DIR: mkdtempSync(join(tmpdir(), 'cais-')),
      CAIS_WEB_DIR: '/nonexistent',
    }),
  );
const json = { 'content-type': 'application/json' };

describe('autenticação', () => {
  it('bloqueia a API sem sessão e deixa o healthz público', async () => {
    const app = await newApp();
    expect((await app.inject('/api/plan')).statusCode).toBe(401);
    expect((await app.inject('/healthz')).statusCode).toBe(200);
    expect((await app.inject('/api/auth/me')).json()).toEqual({
      configured: false,
      user: null,
      wizardDone: false,
    });
  });

  it('setup cria o admin uma única vez e a sessão desbloqueia a API', async () => {
    const app = await newApp();
    const body = { username: 'rita', password: 'uma-password-longa' };
    const r = await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      headers: json,
      payload: body,
    });
    expect(r.statusCode).toBe(200);
    const set = r.headers['set-cookie'] as string;
    expect(set).toMatch(/HttpOnly/i);
    expect(set).toMatch(/SameSite=Strict/i);
    const cookie = set.split(';')[0]!;
    expect((await app.inject({ url: '/api/desired', headers: { cookie } })).statusCode).toBe(200);
    const again = await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      headers: json,
      payload: body,
    });
    expect(again.statusCode).toBe(409);
  });

  it('login rejeita password errada, aceita a certa e logout invalida a sessão', async () => {
    const app = await newApp();
    const body = { username: 'rita', password: 'uma-password-longa' };
    await app.inject({ method: 'POST', url: '/api/auth/setup', headers: json, payload: body });
    const bad = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: json,
      payload: { ...body, password: 'errada-errada' },
    });
    expect(bad.statusCode).toBe(401);
    const ok = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: json,
      payload: body,
    });
    const cookie = (ok.headers['set-cookie'] as string).split(';')[0]!;
    await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } });
    expect((await app.inject({ url: '/api/desired', headers: { cookie } })).statusCode).toBe(401);
  });

  it('bloqueia depois de 5 tentativas falhadas', async () => {
    const app = await newApp();
    const body = { username: 'rita', password: 'uma-password-longa' };
    await app.inject({ method: 'POST', url: '/api/auth/setup', headers: json, payload: body });
    let last = 0;
    for (let i = 0; i < 6; i++) {
      last = (
        await app.inject({
          method: 'POST',
          url: '/api/auth/login',
          headers: json,
          payload: { ...body, password: 'errada-errada' },
        })
      ).statusCode;
    }
    expect(last).toBe(429);
  });
});

describe('vault', () => {
  it('cifra e decifra, e falha com outra chave', () => {
    const v = createVault('segredo-a');
    const blob = v.encrypt('api-key-123');
    expect(blob).not.toContain('api-key-123');
    expect(v.decrypt(blob)).toBe('api-key-123');
    expect(() => createVault('segredo-b').decrypt(blob)).toThrow();
  });
});

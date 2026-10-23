import { describe, expect, it } from 'vitest';
import { ArrClient } from '../reconcile/arr.js';
import type { Ctx } from './ctx.js';
import { defaultDesired } from './desired.js';
import { allFields } from './fields.js';

const SCHEMA = [
  {
    implementation: 'Ntfy',
    fields: [{ name: 'serverUrl' }, { name: 'topics' }, { name: 'accessToken' }],
  },
  { implementation: 'Discord', fields: [{ name: 'webHookUrl' }] },
];

/** Sonarr falso só com o recurso `notification`. */
function fakeCtx(secret?: string) {
  let items: Record<string, unknown>[] = [];
  const calls: string[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname.replace('/api/v3/', '');
    const method = init.method ?? 'GET';
    calls.push(`${method} ${path}`);
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    if (path === 'notification/schema') return json(SCHEMA);
    if (path === 'notification' && method === 'GET') return json(items);
    if (path === 'notification' && method === 'POST') {
      items = [{ id: 1, ...JSON.parse(init.body as string) }];
      return json(items[0]);
    }
    if (path === 'notification/1' && method === 'DELETE') {
      items = [];
      return json({});
    }
    return new Response('{}', { status: 404 });
  }) as unknown as typeof fetch;
  const sonarr = new ArrClient('Sonarr', 'http://x', 'k', 'v3', fetchImpl);
  const ctx = { sonarr, getSecret: () => secret } as unknown as Ctx;
  const field = (d = defaultDesired()) => allFields(d).find((f) => f.id === 'sonarr.notification')!;
  return { ctx, field, items: () => items, calls };
}

describe('notificações', () => {
  it('por omissão (none) não há diferença e não cria nada', async () => {
    const { ctx, field } = fakeCtx();
    const d = defaultDesired();
    const f = field(d);
    expect(await f.read(ctx)).toEqual(f.desired(d));
  });

  it('ntfy cria o recurso com tópico e gatilhos; trocar para Discord apaga só o nosso', async () => {
    const { ctx, field, items } = fakeCtx('segredo-webhook');
    const d = defaultDesired();
    d.notifications = { ...d.notifications, type: 'ntfy', ntfyTopic: 'meu-topico' };
    await field(d).write(ctx, field(d).desired(d));
    expect(items()[0]).toMatchObject({
      name: 'MediaStack',
      implementation: 'Ntfy',
      onDownload: true,
    });
    expect(await field(d).read(ctx)).toMatchObject({ type: 'ntfy', topic: 'meu-topico' });

    d.notifications.type = 'discord';
    await field(d).write(ctx, field(d).desired(d));
    expect(items()).toHaveLength(1);
    expect(items()[0]).toMatchObject({ implementation: 'Discord' });
  });

  it('desligar (none) remove o recurso do MediaStack', async () => {
    const { ctx, field, items } = fakeCtx();
    const d = defaultDesired();
    d.notifications.type = 'ntfy';
    d.notifications.ntfyTopic = 't';
    await field(d).write(ctx, field(d).desired(d));
    expect(items()).toHaveLength(1);
    d.notifications.type = 'none';
    await field(d).write(ctx, field(d).desired(d));
    expect(items()).toHaveLength(0);
  });

  it('Discord sem segredo falha com uma mensagem clara', async () => {
    const { ctx, field } = fakeCtx(undefined);
    const d = defaultDesired();
    d.notifications.type = 'discord';
    await expect(field(d).write(ctx, field(d).desired(d))).rejects.toThrow(/falta o segredo/);
  });
});

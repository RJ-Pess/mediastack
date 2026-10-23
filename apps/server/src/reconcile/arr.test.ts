import { describe, expect, it } from 'vitest';
import { ArrClient } from './arr.js';

/** Servidor falso em memória com um único recurso `downloadclient`. */
function fakeArr() {
  let items: Record<string, unknown>[] = [];
  const calls: string[] = [];
  const schema = [
    {
      implementation: 'QBittorrent',
      fields: [
        { name: 'host', value: '' },
        { name: 'password', value: '' },
      ],
    },
  ];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname.replace('/api/v3/', '');
    const method = init.method ?? 'GET';
    calls.push(`${method} ${path}`);
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    if (path === 'downloadclient/schema') return json(schema);
    if (path === 'downloadclient' && method === 'GET') return json(items);
    if (method === 'POST') {
      items = [{ id: 1, ...JSON.parse(init.body as string) }];
      return json(items[0]);
    }
    if (method === 'PUT') {
      items = [JSON.parse(init.body as string)];
      return json(items[0]);
    }
    return new Response('nope', { status: 404 });
  }) as unknown as typeof fetch;
  return {
    fetchImpl,
    calls,
    mask: () =>
      (items = items.map((i) => ({
        ...i,
        fields: (i.fields as { name: string; value: unknown }[]).map((f) =>
          f.name === 'password' ? { ...f, value: '********' } : f,
        ),
      }))),
  };
}

describe('ArrClient.ensure', () => {
  it('cria, depois não faz nada, depois atualiza quando há drift', async () => {
    const fake = fakeArr();
    const c = new ArrClient('Sonarr', 'http://x', 'k', 'v3', fake.fetchImpl);
    const want = { host: 'qbittorrent', password: 'pw' };
    expect(await c.ensure('downloadclient', 'MediaStack qBittorrent', 'QBittorrent', want)).toBe(
      'created',
    );
    fake.mask(); // o serviço devolve a password mascarada
    expect(await c.ensure('downloadclient', 'MediaStack qBittorrent', 'QBittorrent', want)).toBe(
      'unchanged',
    );
    expect(
      await c.ensure('downloadclient', 'MediaStack qBittorrent', 'QBittorrent', {
        ...want,
        host: 'outro',
      }),
    ).toBe('updated');
    expect(fake.calls.filter((x) => x.startsWith('POST') || x.startsWith('PUT'))).toHaveLength(2);
  });

  it('campos createOnly (geridos pelo plan) não são repostos', async () => {
    const fake = fakeArr();
    const c = new ArrClient('Sonarr', 'http://x', 'k', 'v3', fake.fetchImpl);
    await c.ensure('downloadclient', 'MediaStack qBittorrent', 'QBittorrent', {
      host: 'a',
      password: 'pw',
    });
    fake.mask();
    const want = { host: 'b', password: 'pw' }; // "host" mudou entretanto (feito pelo plan)
    expect(
      await c.ensure('downloadclient', 'MediaStack qBittorrent', 'QBittorrent', want, {}, ['host']),
    ).toBe('unchanged');
    // sem createOnly o reconcile repunha o valor
    expect(await c.ensure('downloadclient', 'MediaStack qBittorrent', 'QBittorrent', want)).toBe(
      'updated',
    );
  });
});

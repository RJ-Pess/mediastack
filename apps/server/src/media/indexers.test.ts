import { beforeEach, describe, expect, it } from 'vitest';
import { ArrClient } from '../reconcile/arr.js';
import {
  addIndexer,
  listIndexers,
  resetIndexerSchemaCache,
  setIndexerEnabled,
  testIndexer,
} from './indexers.js';

const schema = [
  {
    implementation: 'Cardigann',
    definitionName: 'pub1',
    name: 'Pub1',
    privacy: 'public',
    protocol: 'torrent',
    language: 'en',
    fields: [],
  },
  {
    implementation: 'Cardigann',
    definitionName: 'priv1',
    name: 'Priv1',
    privacy: 'private',
    protocol: 'torrent',
    fields: [],
  },
  {
    implementation: 'Torznab',
    name: 'Generic Torznab',
    privacy: 'public',
    protocol: 'torrent',
    fields: [],
  },
];

function fake() {
  const installed: Record<string, unknown>[] = [];
  const calls: string[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname.replace('/api/v1/', '');
    const method = init.method ?? 'GET';
    calls.push(`${method} ${path}`);
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
    if (path === 'indexer/schema') return json(schema);
    if (path === 'appprofile') return json([{ id: 7 }]);
    if (path === 'indexer' && method === 'GET') return json(installed);
    if (path === 'indexer' && method === 'POST') {
      const b = JSON.parse(init.body as string);
      installed.push({ id: 1, ...b });
      return json(installed[0]);
    }
    if (path === 'indexer/1' && method === 'GET') return json(installed[0]);
    if (path === 'indexer/1' && method === 'PUT') {
      installed[0] = JSON.parse(init.body as string);
      return json(installed[0]);
    }
    if (path === 'indexer/test') {
      return json([{ propertyName: '', errorMessage: 'Unable to connect to indexer' }], 400);
    }
    return json({}, 404);
  }) as unknown as typeof fetch;
  return { client: new ArrClient('Prowlarr', 'http://p', 'k', 'v1', fetchImpl), installed, calls };
}

describe('indexers', () => {
  beforeEach(() => resetIndexerSchemaCache());

  it('só oferece indexadores públicos Cardigann ainda não instalados', async () => {
    const { client } = fake();
    const l = await listIndexers(client);
    expect(l.available.map((a) => a.definitionName)).toEqual(['pub1']);
  });

  it('adiciona com o perfil da app, ativa/desativa e deixa de o oferecer', async () => {
    const { client, installed } = fake();
    const added = await addIndexer(client, 'pub1');
    expect(installed[0]).toMatchObject({ appProfileId: 7, enable: true, name: 'Pub1' });
    expect((await listIndexers(client)).available).toEqual([]);

    await setIndexerEnabled(client, added.id, false);
    expect(installed[0]).toMatchObject({ enable: false });
  });

  it('recusa indexadores privados e desconhecidos', async () => {
    const { client } = fake();
    await expect(addIndexer(client, 'priv1')).rejects.toThrow(/desconhecido/);
    await expect(addIndexer(client, 'nada')).rejects.toThrow(/desconhecido/);
  });

  it('o teste devolve a mensagem de erro do Prowlarr', async () => {
    const { client } = fake();
    await addIndexer(client, 'pub1');
    expect(await testIndexer(client, 1)).toEqual({
      ok: false,
      message: 'Unable to connect to indexer',
    });
  });
});

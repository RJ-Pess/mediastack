import { describe, expect, it } from 'vitest';
import type { Ctx } from './ctx.js';
import { Store } from './db.js';
import { defaultDesired } from './desired.js';
import { adopt, apply, plan } from './engine.js';

/** Contexto falso em memória: o suficiente para exercitar o plan/apply. */
function fakeCtx() {
  const state = {
    tvCategory: 'tv',
    movieCategory: 'movies',
    roots: { sonarr: ['/data/media/tv'], radarr: ['/data/media/movies'] } as Record<
      string,
      string[]
    >,
    prefs: { dl_limit: 0, up_limit: 0, max_ratio_enabled: false, max_ratio: -1 },
    cats: {} as Record<string, { name: string; savePath: string }>,
  };
  const arr = (app: 'sonarr' | 'radarr', field: string, key: 'tvCategory' | 'movieCategory') => ({
    get: async (path: string) =>
      path === 'rootfolder'
        ? state.roots[app]!.map((p) => ({ path: p }))
        : [{ name: 'Cais qBittorrent', fields: [{ name: field, value: state[key] }] }],
    request: async (_m: string, _p: string, body: { path: string }) =>
      void state.roots[app]!.push(body.path),
    ensure: async (_c: string, _n: string, _i: string, f: Record<string, string>) => {
      state[key] = f[field]!;
      return 'updated';
    },
  });
  const ctx = {
    sonarr: arr('sonarr', 'tvCategory', 'tvCategory'),
    radarr: arr('radarr', 'movieCategory', 'movieCategory'),
    qbit: {
      getPrefs: async () => ({ ...state.prefs }),
      setPrefs: async (p: object) => void Object.assign(state.prefs, p),
      getCategories: async () => state.cats,
      setCategory: async (name: string, savePath: string) =>
        void (state.cats[name] = { name, savePath }),
    },
  } as unknown as Ctx;
  return { ctx, state };
}

describe('plan/apply', () => {
  it('só mostra o que difere e converge num único apply', async () => {
    const { ctx, state } = fakeCtx();
    const d = defaultDesired();
    d.downloads.downKiBps = 5000;
    d.downloads.seedRatio = 2;
    d.storage.extraMoviesRoots = ['/data/media/filmes-bons'];

    const p1 = await plan(ctx, d);
    expect(p1.changes.map((c) => c.fieldId)).toEqual([
      'qbittorrent.category.movies',
      'qbittorrent.category.tv',
      'qbittorrent.limit.down',
      'qbittorrent.seed.ratio',
      'radarr.rootfolders',
    ]);

    const store = new Store(':memory:');
    const r = await apply(ctx, d, store, 'teste');
    expect(r.failed).toEqual([]);
    expect(state.prefs.dl_limit).toBe(5000 * 1024);
    expect(state.roots.radarr).toContain('/data/media/filmes-bons');
    expect(store.listAudit()).toHaveLength(5);

    // idempotência: segundo plan sem diferenças, segundo apply sem escritas
    expect((await plan(ctx, d)).changes).toEqual([]);
    await apply(ctx, d, store, 'teste');
    expect(store.listAudit()).toHaveLength(5);
  });

  it('deteta drift e permite adotar o valor real', async () => {
    const { ctx, state } = fakeCtx();
    const d = defaultDesired();
    const store = new Store(':memory:');
    await apply(ctx, d, store, 'teste');
    state.prefs.up_limit = 100 * 1024; // alteração feita na UI nativa

    const drift = await plan(ctx, d);
    expect(drift.changes).toMatchObject([
      { fieldId: 'qbittorrent.limit.up', before: 100, after: 0 },
    ]);
    const adopted = await adopt(ctx, d, 'qbittorrent.limit.up');
    expect(adopted.downloads.upKiBps).toBe(100);
    expect((await plan(ctx, adopted)).changes).toEqual([]);
  });

  it('nunca remove root folders que não estão no estado desejado', async () => {
    const { ctx, state } = fakeCtx();
    state.roots.sonarr!.push('/data/media/outra');
    const store = new Store(':memory:');
    await apply(ctx, defaultDesired(), store, 'teste');
    expect(state.roots.sonarr).toContain('/data/media/outra');
  });
});

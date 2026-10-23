import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';
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
    enabled: [] as string[],
    profiles: [{ profileId: 1, name: 'Outro', items: [] }] as {
      profileId: number;
      name: string;
      items: { language: string }[];
    }[],
    defaultProfile: 0,
  };
  const bazarr = {
    getLanguages: async () =>
      ['pt', 'en', 'fr'].map((c) => ({ code2: c, name: c, enabled: state.enabled.includes(c) })),
    enableLanguages: async (codes: string[]) =>
      void (state.enabled = [...new Set([...state.enabled, ...codes])]),
    getProfiles: async () => state.profiles,
    upsertProfile: async (name: string, langs: string[]) => {
      const items = langs.map((language) => ({ language }));
      const mine = state.profiles.find((p) => p.name === name);
      if (mine) mine.items = items;
      else state.profiles.push({ profileId: 2, name, items });
    },
    getSettings: async () => ({
      general: {
        serie_default_profile: state.defaultProfile,
        movie_default_profile: state.defaultProfile,
      },
    }),
    ensureSettings: async (d: { general: { serie_default_profile: number } }) =>
      void (state.defaultProfile = d.general.serie_default_profile),
  };
  const arr = (app: 'sonarr' | 'radarr', field: string, key: 'tvCategory' | 'movieCategory') => ({
    get: async (path: string) =>
      path === 'rootfolder'
        ? state.roots[app]!.map((p) => ({ path: p }))
        : path === 'config/host'
          ? { id: 1, backupInterval: 7, backupRetention: 28 }
          : path === 'qualityprofile'
            ? [{ name: 'HD Bluray + WEB' }, { name: 'WEB-1080p' }]
            : [{ name: 'MediaStack qBittorrent', fields: [{ name: field, value: state[key] }] }],
    request: async (_m: string, _p: string, body: { path: string }) =>
      void state.roots[app]!.push(body.path),
    ensure: async (_c: string, _n: string, _i: string, f: Record<string, string>) => {
      state[key] = f[field]!;
      return 'updated';
    },
  });
  const ctx = {
    seerr: null,
    prowlarr: {
      get: async (path: string) =>
        path === 'notification' ? [] : { id: 1, backupInterval: 7, backupRetention: 28 },
      request: async () => undefined,
    },
    config: loadConfig({}),
    getSecret: () => undefined,
    secrets: { 'radarr.key': 'rk', 'sonarr.key': 'sk' },
    recyclarrDir: mkdtempSync(join(tmpdir(), 'mediastack-rcl-')),
    dataMount: mkdtempSync(join(tmpdir(), 'mediastack-data-')),
    bazarr,
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
    expect(p1.errors).toEqual([]);
    expect(p1.changes.map((c) => c.fieldId)).toEqual([
      'bazarr.languages.enabled',
      'bazarr.profile',
      'bazarr.profile.default',
      'qbittorrent.category.movies',
      'qbittorrent.category.tv',
      'qbittorrent.limit.down',
      'qbittorrent.seed.ratio',
      'radarr.rootfolders',
      'recyclarr.request',
    ]);

    const store = new Store(':memory:');
    const r = await apply(ctx, d, store, 'teste');
    expect(r.failed).toEqual([]);
    expect(state.prefs.dl_limit).toBe(5000 * 1024);
    expect(state.roots.radarr).toContain('/data/media/filmes-bons');
    // a pasta escolhida na UI foi criada pelo próprio MediaStack (o Radarr só aceita pastas que existam)
    expect(
      existsSync(join((ctx as unknown as { dataMount: string }).dataMount, 'media/filmes-bons')),
    ).toBe(true);
    expect(state.profiles.map((p) => p.name)).toEqual(['Outro', 'MediaStack']); // não apaga o existente
    expect(state.defaultProfile).toBe(2);
    expect(store.listAudit()).toHaveLength(9);

    // idempotência: segundo plan sem diferenças, segundo apply sem escritas
    expect((await plan(ctx, d)).changes).toEqual([]);
    await apply(ctx, d, store, 'teste');
    expect(store.listAudit()).toHaveLength(9);
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

  it('seeding por tempo e horário de velocidade: formato exato da API e idempotência', async () => {
    const { ctx, state } = fakeCtx();
    const d = defaultDesired();
    d.downloads.seedTimeMinutes = 120;
    d.downloads.schedule = {
      enabled: true,
      fromHour: 1,
      toHour: 7,
      altDownKiBps: 512,
      altUpKiBps: 64,
    };
    const store = new Store(':memory:');
    await apply(ctx, d, store, 'teste');
    // a API do qBittorrent quer hora E minuto juntos, e limites em bytes/s
    expect(state.prefs).toMatchObject({
      max_seeding_time_enabled: true,
      max_seeding_time: 120,
      scheduler_enabled: true,
      schedule_from_hour: 1,
      schedule_from_min: 0,
      schedule_to_hour: 7,
      schedule_to_min: 0,
      alt_dl_limit: 512 * 1024,
      alt_up_limit: 64 * 1024,
    });
    expect((await plan(ctx, d)).changes).toEqual([]);

    // desligar só liga o interruptor; os valores guardados não contam para o plano
    d.downloads.schedule.enabled = false;
    d.downloads.seedTimeMinutes = 0;
    await apply(ctx, d, store, 'teste');
    expect(state.prefs).toMatchObject({
      scheduler_enabled: false,
      max_seeding_time_enabled: false,
    });
    expect((await plan(ctx, d)).changes).toEqual([]);
  });

  it('nunca remove root folders que não estão no estado desejado', async () => {
    const { ctx, state } = fakeCtx();
    state.roots.sonarr!.push('/data/media/outra');
    const store = new Store(':memory:');
    await apply(ctx, defaultDesired(), store, 'teste');
    expect(state.roots.sonarr).toContain('/data/media/outra');
  });
});

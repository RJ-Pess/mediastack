import type { ServiceId } from '../services.js';
import { MANAGED_PREFIX } from '../reconcile/wiring.js';
import type { ArrClient, ArrResource } from '../reconcile/arr.js';
import type { Ctx } from './ctx.js';
import type { Desired } from './desired.js';

/**
 * Um valor configurável num serviço. O plan lê o valor real e compara com o desejado;
 * o apply escreve; a deteção de drift é um plan sobre o estado já aplicado.
 */
export interface Field<T = unknown> {
  id: string;
  service: ServiceId;
  section: 'Armazenamento' | 'Downloads';
  label: string;
  /** `undefined` = campo não gerido pelo estado desejado. */
  desired(s: Desired): T | undefined;
  read(ctx: Ctx): Promise<T>;
  write(ctx: Ctx, value: T): Promise<void>;
  /** Igualdade desejado/real (por omissão, JSON). */
  equal?(desired: T, actual: T): boolean;
  /** Copia o valor real para o estado desejado ("adotar"). */
  adopt(s: Desired, actual: T): Desired;
}

const clone = <T>(x: T): T => structuredClone(x);
const downloadClient = async (c: ArrClient) =>
  (await c.get<ArrResource[]>('downloadclient')).find(
    (r) => r.name === `${MANAGED_PREFIX} qBittorrent`,
  );

const categoryField = (
  app: 'sonarr' | 'radarr',
  key: 'tv' | 'movies',
  fieldName: string,
): Field<string> => ({
  id: `${app}.downloadclient.category`,
  service: app,
  section: 'Downloads',
  label: 'Categoria no qBittorrent',
  desired: (s) => s.downloads.categories[key],
  read: async (ctx) => {
    const dc = await downloadClient(ctx[app]);
    return String(dc?.fields?.find((f) => f.name === fieldName)?.value ?? '');
  },
  write: async (ctx, v) => {
    const dc = await downloadClient(ctx[app]);
    if (!dc) throw new Error('download client Cais qBittorrent não existe (corre o reconcile)');
    await ctx[app].ensure('downloadclient', dc.name, 'QBittorrent', { [fieldName]: v });
  },
  adopt: (s, v) => {
    const n = clone(s);
    n.downloads.categories[key] = v;
    return n;
  },
});

const rootsField = (app: 'sonarr' | 'radarr'): Field<string[]> => ({
  id: `${app}.rootfolders`,
  service: app,
  section: 'Armazenamento',
  label: 'Root folders',
  desired: (s) =>
    app === 'sonarr'
      ? [s.storage.tvRoot, ...s.storage.extraTvRoots]
      : [s.storage.moviesRoot, ...s.storage.extraMoviesRoots],
  read: async (ctx) =>
    (await ctx[app].get<{ path: string }[]>('rootfolder')).map((r) => r.path).sort(),
  // Só adiciona: nunca remove pastas que o Cais não criou.
  write: async (ctx, want) => {
    const have = (await ctx[app].get<{ path: string }[]>('rootfolder')).map((r) => r.path);
    for (const path of want.filter((p) => !have.includes(p))) {
      await ctx[app].request('POST', 'rootfolder', { path });
    }
  },
  equal: (want, have) => want.every((p) => have.includes(p)),
  adopt: (s, have) => {
    const n = clone(s);
    const [main, ...extra] = have;
    if (app === 'sonarr') {
      n.storage.tvRoot = main ?? n.storage.tvRoot;
      n.storage.extraTvRoots = extra;
    } else {
      n.storage.moviesRoot = main ?? n.storage.moviesRoot;
      n.storage.extraMoviesRoots = extra;
    }
    return n;
  },
});

const prefField = (
  id: string,
  label: string,
  get: (s: Desired) => number,
  set: (s: Desired, v: number) => void,
  read: (p: Awaited<ReturnType<Ctx['qbit']['getPrefs']>>) => number,
  write: (v: number) => Record<string, unknown>,
): Field<number> => ({
  id,
  service: 'qbittorrent',
  section: 'Downloads',
  label,
  desired: get,
  read: async (ctx) => read(await ctx.qbit.getPrefs()),
  write: (ctx, v) => ctx.qbit.setPrefs(write(v)),
  adopt: (s, v) => {
    const n = clone(s);
    set(n, v);
    return n;
  },
});

// Os campos têm tipos de valor diferentes; o engine só os trata como `unknown`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyField = Field<any>;

export const staticFields: AnyField[] = [
  rootsField('sonarr'),
  rootsField('radarr'),
  categoryField('sonarr', 'tv', 'tvCategory'),
  categoryField('radarr', 'movies', 'movieCategory'),
  prefField(
    'qbittorrent.limit.down',
    'Limite de descarga (KiB/s, 0 = sem limite)',
    (s) => s.downloads.downKiBps,
    (s, v) => (s.downloads.downKiBps = v),
    (p) => Math.round(p.dl_limit / 1024),
    (v) => ({ dl_limit: v * 1024 }),
  ),
  prefField(
    'qbittorrent.limit.up',
    'Limite de envio (KiB/s, 0 = sem limite)',
    (s) => s.downloads.upKiBps,
    (s, v) => (s.downloads.upKiBps = v),
    (p) => Math.round(p.up_limit / 1024),
    (v) => ({ up_limit: v * 1024 }),
  ),
  prefField(
    'qbittorrent.seed.ratio',
    'Rácio máximo de seeding (0 = desligado)',
    (s) => s.downloads.seedRatio,
    (s, v) => (s.downloads.seedRatio = v),
    (p) => (p.max_ratio_enabled ? p.max_ratio : 0),
    (v) => ({ max_ratio_enabled: v > 0, max_ratio: v > 0 ? v : -1 }),
  ),
];

/** Campos que dependem do estado desejado (nomes de categoria dinâmicos). */
export function allFields(d: Desired): AnyField[] {
  const catFields = (['tv', 'movies'] as const).map((key): Field<string> => {
    const name = d.downloads.categories[key];
    return {
      id: `qbittorrent.category.${key}`,
      service: 'qbittorrent',
      section: 'Downloads',
      label: `Pasta da categoria "${name}" (${key === 'tv' ? 'séries' : 'filmes'})`,
      desired: (s) => `${s.downloads.torrentsRoot}/${name}`,
      read: async (ctx) => (await ctx.qbit.getCategories())[name]?.savePath ?? '',
      write: async (ctx, v) => {
        const exists = name in (await ctx.qbit.getCategories());
        await ctx.qbit.setCategory(name, v, exists);
      },
      // A pasta deriva de torrentsRoot + nome da categoria; não há campo próprio para adotar.
      adopt: (s) => s,
    };
  });
  return [...staticFields, ...catFields];
}

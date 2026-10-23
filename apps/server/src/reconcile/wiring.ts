import type { Config } from '../config.js';
import type { SecretName } from '../init/secrets.js';
import { BazarrClient } from './bazarr.js';
import { SeerrClient } from './seerr.js';
import { ArrClient, type ArrResource, type EnsureResult } from './arr.js';

export interface StepResult {
  step: string;
  /** `skipped`: falta um pré-requisito (ex.: o Seerr ainda não foi ligado ao Jellyfin). */
  result: EnsureResult | 'skipped';
}

type Secrets = Record<SecretName, string>;

export const MANAGED_PREFIX = 'MediaStack';

/** Liga os serviços entre si. Cada passo é idempotente. */
export async function wireServices(
  c: Config,
  s: Secrets,
  fetchImpl: typeof fetch = fetch,
  seerrKey?: string,
): Promise<StepResult[]> {
  const sonarr = new ArrClient('Sonarr', c.MEDIASTACK_SONARR_URL, s['sonarr.key'], 'v3', fetchImpl);
  const radarr = new ArrClient('Radarr', c.MEDIASTACK_RADARR_URL, s['radarr.key'], 'v3', fetchImpl);
  const prowlarr = new ArrClient(
    'Prowlarr',
    c.MEDIASTACK_PROWLARR_URL,
    s['prowlarr.key'],
    'v1',
    fetchImpl,
  );
  const out: StepResult[] = [];
  const record = (step: string, result: StepResult['result']) => out.push({ step, result });

  // Sonarr / Radarr -> qBittorrent + root folders
  for (const [app, client, categoryField, category, root] of [
    ['Sonarr', sonarr, 'tvCategory', 'tv', '/data/media/tv'],
    ['Radarr', radarr, 'movieCategory', 'movies', '/data/media/movies'],
  ] as const) {
    record(
      `${app} → qBittorrent`,
      await client.ensure(
        'downloadclient',
        `${MANAGED_PREFIX} qBittorrent`,
        'QBittorrent',
        {
          host: new URL(c.MEDIASTACK_QBITTORRENT_URL).hostname,
          port: Number(new URL(c.MEDIASTACK_QBITTORRENT_URL).port || 80),
          useSsl: false,
          username: c.MEDIASTACK_QBITTORRENT_USER,
          password: s['qbittorrent.password'],
          [categoryField]: category,
        },
        { enable: true },
        // A categoria é gerida pelo plan (campo *.downloadclient.category).
        [categoryField],
      ),
    );
    const roots = await client.get<ArrResource[]>('rootfolder');
    if (roots.some((r) => (r as { path?: string }).path === root)) {
      record(`${app} root folder ${root}`, 'unchanged');
    } else {
      await client.request('POST', 'rootfolder', { path: root });
      record(`${app} root folder ${root}`, 'created');
    }
  }

  // Prowlarr: tag + proxy Byparr (API FlareSolverr) + applications
  const tags = await prowlarr.get<{ id: number; label: string }[]>('tag');
  let tag = tags.find((t) => t.label === 'cloudflare');
  if (!tag) {
    tag = await prowlarr.request<{ id: number; label: string }>('POST', 'tag', {
      label: 'cloudflare',
    });
    record('Prowlarr tag cloudflare', 'created');
  } else {
    record('Prowlarr tag cloudflare', 'unchanged');
  }
  record(
    'Prowlarr → Byparr',
    await prowlarr.ensure(
      'indexerProxy',
      `${MANAGED_PREFIX} Byparr`,
      'FlareSolverr',
      { host: `${c.MEDIASTACK_BYPARR_URL.replace(/\/$/, '')}/`, requestTimeout: 60 },
      { tags: [tag.id] },
    ),
  );
  for (const [impl, url, key] of [
    ['Sonarr', c.MEDIASTACK_SONARR_URL, s['sonarr.key']],
    ['Radarr', c.MEDIASTACK_RADARR_URL, s['radarr.key']],
  ] as const) {
    record(
      `Prowlarr → ${impl}`,
      await prowlarr.ensure(
        'applications',
        `${MANAGED_PREFIX} ${impl}`,
        impl,
        { prowlarrUrl: c.MEDIASTACK_PROWLARR_URL, baseUrl: url, apiKey: key },
        { syncLevel: 'fullSync' },
      ),
    );
  }

  // Bazarr -> Sonarr / Radarr
  const bazarr = new BazarrClient(c.MEDIASTACK_BAZARR_URL, s['bazarr.key'], fetchImpl);
  const link = (url: string, apiKey: string) => ({
    ip: new URL(url).hostname,
    port: Number(new URL(url).port || 80),
    apikey: apiKey,
    ssl: false,
  });
  record(
    'Bazarr → Sonarr/Radarr',
    await bazarr.ensureSettings({
      general: { use_sonarr: true, use_radarr: true },
      sonarr: link(c.MEDIASTACK_SONARR_URL, s['sonarr.key']),
      radarr: link(c.MEDIASTACK_RADARR_URL, s['radarr.key']),
    }),
  );

  // Seerr -> Sonarr / Radarr (só depois de o Seerr estar ligado ao Jellyfin)
  if (!seerrKey) {
    record('Seerr → Sonarr/Radarr', 'skipped');
  } else {
    const seerr = new SeerrClient(c.MEDIASTACK_SEERR_URL, seerrKey, fetchImpl);
    for (const kind of ['sonarr', 'radarr'] as const) {
      const client = kind === 'sonarr' ? sonarr : radarr;
      record(
        `Seerr → ${kind === 'sonarr' ? 'Sonarr' : 'Radarr'}`,
        // O perfil é gerido pelo plan (campo seerr.profile.*): o reconcile só o define ao criar.
        await seerr.ensureArr(kind, await seerrDefinition(c, s, kind, client), [
          'activeProfileId',
          'activeProfileName',
        ]),
      );
    }
  }
  return out;
}

/**
 * Definição do Sonarr/Radarr no Seerr. Perfil: o pedido (`profileName`), senão "HD-1080p"
 * (perfil de origem do *arr), senão o primeiro.
 */
export async function seerrDefinition(
  c: Config,
  s: Secrets,
  kind: 'sonarr' | 'radarr',
  client: ArrClient,
  profileName?: string,
) {
  const profiles = await client.get<{ id: number; name: string }[]>('qualityprofile');
  const profile =
    profiles.find((p) => p.name === profileName) ??
    profiles.find((p) => p.name === 'HD-1080p') ??
    profiles[0];
  if (!profile) throw new Error(`${kind}: sem perfis de qualidade`);
  const u = new URL(kind === 'sonarr' ? c.MEDIASTACK_SONARR_URL : c.MEDIASTACK_RADARR_URL);
  return {
    name: `${MANAGED_PREFIX} ${kind === 'sonarr' ? 'Sonarr' : 'Radarr'}`,
    hostname: u.hostname,
    port: Number(u.port || 80),
    apiKey: s[`${kind}.key`],
    useSsl: false,
    baseUrl: '',
    activeProfileId: profile.id,
    activeProfileName: profile.name,
    activeDirectory: kind === 'sonarr' ? '/data/media/tv' : '/data/media/movies',
    isDefault: true,
  };
}

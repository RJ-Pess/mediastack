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

export const MANAGED_PREFIX = 'Cais';

/** Liga os serviços entre si. Cada passo é idempotente. */
export async function wireServices(
  c: Config,
  s: Secrets,
  fetchImpl: typeof fetch = fetch,
  seerrKey?: string,
): Promise<StepResult[]> {
  const sonarr = new ArrClient('Sonarr', c.CAIS_SONARR_URL, s['sonarr.key'], 'v3', fetchImpl);
  const radarr = new ArrClient('Radarr', c.CAIS_RADARR_URL, s['radarr.key'], 'v3', fetchImpl);
  const prowlarr = new ArrClient(
    'Prowlarr',
    c.CAIS_PROWLARR_URL,
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
          host: new URL(c.CAIS_QBITTORRENT_URL).hostname,
          port: Number(new URL(c.CAIS_QBITTORRENT_URL).port || 80),
          useSsl: false,
          username: 'cais',
          password: s['qbittorrent.password'],
          [categoryField]: category,
        },
        { enable: true },
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
      { host: `${c.CAIS_BYPARR_URL.replace(/\/$/, '')}/`, requestTimeout: 60 },
      { tags: [tag.id] },
    ),
  );
  for (const [impl, url, key] of [
    ['Sonarr', c.CAIS_SONARR_URL, s['sonarr.key']],
    ['Radarr', c.CAIS_RADARR_URL, s['radarr.key']],
  ] as const) {
    record(
      `Prowlarr → ${impl}`,
      await prowlarr.ensure(
        'applications',
        `${MANAGED_PREFIX} ${impl}`,
        impl,
        { prowlarrUrl: c.CAIS_PROWLARR_URL, baseUrl: url, apiKey: key },
        { syncLevel: 'fullSync' },
      ),
    );
  }

  // Bazarr -> Sonarr / Radarr
  const bazarr = new BazarrClient(c.CAIS_BAZARR_URL, s['bazarr.key'], fetchImpl);
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
      sonarr: link(c.CAIS_SONARR_URL, s['sonarr.key']),
      radarr: link(c.CAIS_RADARR_URL, s['radarr.key']),
    }),
  );

  // Seerr -> Sonarr / Radarr (só depois de o Seerr estar ligado ao Jellyfin)
  if (!seerrKey) {
    record('Seerr → Sonarr/Radarr', 'skipped');
  } else {
    const seerr = new SeerrClient(c.CAIS_SEERR_URL, seerrKey, fetchImpl);
    for (const [kind, client, url, key, root] of [
      ['sonarr', sonarr, c.CAIS_SONARR_URL, s['sonarr.key'], '/data/media/tv'],
      ['radarr', radarr, c.CAIS_RADARR_URL, s['radarr.key'], '/data/media/movies'],
    ] as const) {
      // Perfil por omissão: "HD-1080p" se existir, senão o primeiro (os perfis TRaSH chegam na Fase 5).
      const profiles = await client.get<{ id: number; name: string }[]>('qualityprofile');
      const profile = profiles.find((p) => p.name === 'HD-1080p') ?? profiles[0];
      if (!profile) throw new Error(`${kind}: sem perfis de qualidade`);
      const u = new URL(url);
      record(
        `Seerr → ${kind === 'sonarr' ? 'Sonarr' : 'Radarr'}`,
        await seerr.ensureArr(kind, {
          name: `${MANAGED_PREFIX} ${kind === 'sonarr' ? 'Sonarr' : 'Radarr'}`,
          hostname: u.hostname,
          port: Number(u.port || 80),
          apiKey: key,
          useSsl: false,
          baseUrl: '',
          activeProfileId: profile.id,
          activeProfileName: profile.name,
          activeDirectory: root,
          isDefault: true,
        }),
      );
    }
  }
  return out;
}

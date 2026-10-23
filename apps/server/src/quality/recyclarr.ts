import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** `keep` = não mexer nos perfis de qualidade existentes. */
export type QualityChoice = '1080p' | '4k' | 'both' | 'keep';
/** `keep` = não mexer nos nomes. Os restantes usam os presets TRaSH para esse media server. */
export type NamingScheme = 'keep' | 'jellyfin' | 'plex' | 'emby';

export interface RecyclarrRequest {
  quality: QualityChoice;
  naming: NamingScheme;
}

/** Presets de nomes dos TRaSH Guides (`media_naming` do Recyclarr). */
const NAMING: Record<Exclude<NamingScheme, 'keep'>, { radarr: string; sonarrSeries: string }> = {
  jellyfin: { radarr: 'jellyfin-tmdb', sonarrSeries: 'jellyfin-tvdb' },
  plex: { radarr: 'plex-tmdb', sonarrSeries: 'plex-tvdb' },
  emby: { radarr: 'emby-tmdb', sonarrSeries: 'emby-tvdb' },
};

interface Templates {
  radarr: string[];
  sonarr: string[];
}

/** Templates TRaSH oficiais do Recyclarr (`config create -t <nome>`) por escolha. */
export const TEMPLATES: Record<QualityChoice, Templates> = {
  keep: { radarr: [], sonarr: [] },
  '1080p': { radarr: ['hd-bluray-web'], sonarr: ['web-1080p'] },
  '4k': { radarr: ['uhd-bluray-web'], sonarr: ['web-2160p'] },
  both: { radarr: ['hd-bluray-web', 'uhd-bluray-web'], sonarr: ['web-1080p', 'web-2160p'] },
};

/** Nome do perfil de qualidade que cada template cria no Sonarr/Radarr. */
export const PROFILE_NAME: Record<string, string> = {
  'hd-bluray-web': 'HD Bluray + WEB',
  'uhd-bluray-web': 'UHD Bluray + WEB',
  'web-1080p': 'WEB-1080p',
  'web-2160p': 'WEB-2160p',
};

export const expectedProfiles = (q: QualityChoice, app: 'radarr' | 'sonarr') =>
  TEMPLATES[q][app].map((t) => PROFILE_NAME[t]!);

export interface ServiceLink {
  url: string;
  key: string;
}

/** Ficheiro `request.env` lido pelo sync.sh (formato sh). Os valores são todos controlados pelo MediaStack. */
export function renderRequest(
  req: RecyclarrRequest,
  radarr: ServiceLink,
  sonarr: ServiceLink,
): string {
  const q = req.quality;
  const naming = req.naming === 'keep' ? null : NAMING[req.naming];
  return [
    `MEDIASTACK_QUALITY=${q}`,
    `MEDIASTACK_NAMING=${req.naming}`,
    `RADARR_NAMING=${naming?.radarr ?? ''}`,
    `SONARR_NAMING_SERIES=${naming?.sonarrSeries ?? ''}`,
    `RADARR_URL=${radarr.url}`,
    `RADARR_KEY=${radarr.key}`,
    `RADARR_TEMPLATES="${TEMPLATES[q].radarr.join(' ')}"`,
    `SONARR_URL=${sonarr.url}`,
    `SONARR_KEY=${sonarr.key}`,
    `SONARR_TEMPLATES="${TEMPLATES[q].sonarr.join(' ')}"`,
    '',
  ].join('\n');
}

export function readRequest(dir: string): RecyclarrRequest | null {
  const file = join(dir, 'request.env');
  if (!existsSync(file)) return null;
  const text = readFileSync(file, 'utf8');
  const quality = /^MEDIASTACK_QUALITY=(1080p|4k|both|keep)$/m.exec(text)?.[1] as
    QualityChoice | undefined;
  if (!quality) return null;
  const naming = /^MEDIASTACK_NAMING=(keep|jellyfin|plex|emby)$/m.exec(text)?.[1] as
    NamingScheme | undefined;
  // Pedidos escritos antes de existir o esquema de nomes não mexiam nos nomes.
  return { quality, naming: naming ?? 'keep' };
}

export const readRequestedQuality = (dir: string): QualityChoice | null =>
  readRequest(dir)?.quality ?? null;

/** Escreve o pedido (modo 0600: tem as chaves) e pede uma sincronização. */
export function requestSync(dir: string, content: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'request.env'), content, { mode: 0o600 });
  writeFileSync(join(dir, 'sync.trigger'), '');
}

export interface SyncStatus {
  at: string | null;
  status: 'ok' | 'error' | 'pending' | 'never';
}

export function readSyncStatus(dir: string): SyncStatus {
  if (existsSync(join(dir, 'sync.trigger'))) return { at: null, status: 'pending' };
  const file = join(dir, 'last-sync.txt');
  if (!existsSync(file)) return { at: null, status: 'never' };
  const [at, status] = readFileSync(file, 'utf8').trim().split(' ');
  return { at: at ?? null, status: status === 'ok' ? 'ok' : 'error' };
}

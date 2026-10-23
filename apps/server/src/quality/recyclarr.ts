import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type QualityChoice = '1080p' | '4k' | 'both';

interface Templates {
  radarr: string[];
  sonarr: string[];
}

/** Templates TRaSH oficiais do Recyclarr (`config create -t <nome>`) por escolha. */
export const TEMPLATES: Record<QualityChoice, Templates> = {
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

/** Ficheiro `request.env` lido pelo sync.sh (formato sh). Os valores são todos controlados pelo Cais. */
export function renderRequest(q: QualityChoice, radarr: ServiceLink, sonarr: ServiceLink): string {
  return [
    `CAIS_QUALITY=${q}`,
    `RADARR_URL=${radarr.url}`,
    `RADARR_KEY=${radarr.key}`,
    `RADARR_TEMPLATES="${TEMPLATES[q].radarr.join(' ')}"`,
    `SONARR_URL=${sonarr.url}`,
    `SONARR_KEY=${sonarr.key}`,
    `SONARR_TEMPLATES="${TEMPLATES[q].sonarr.join(' ')}"`,
    '',
  ].join('\n');
}

export function readRequestedQuality(dir: string): QualityChoice | null {
  const file = join(dir, 'request.env');
  if (!existsSync(file)) return null;
  const m = /^CAIS_QUALITY=(1080p|4k|both)$/m.exec(readFileSync(file, 'utf8'));
  return (m?.[1] as QualityChoice | undefined) ?? null;
}

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

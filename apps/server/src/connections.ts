import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Config } from './config.js';
import { SECRET_NAMES, type SecretName } from './init/secrets.js';

export type ServiceKey = 'sonarr' | 'radarr' | 'prowlarr' | 'bazarr' | 'qbittorrent' | 'seerr';
export const SERVICE_KEYS: ServiceKey[] = [
  'sonarr',
  'radarr',
  'prowlarr',
  'bazarr',
  'qbittorrent',
  'seerr',
];

/** Ligação a um serviço já existente (fora do stack do MediaStack). */
export interface Connection {
  url: string;
  /** API key (ou password, no qBittorrent). */
  key: string;
  /** Só para o qBittorrent. */
  username?: string;
}
export type Connections = Partial<Record<ServiceKey, Connection>>;
export type Secrets = Record<SecretName, string>;

/** Como `readSecrets`, mas tolerante: num stack externo os ficheiros podem não existir. */
export function safeReadSecrets(dir: string): Secrets {
  const out = {} as Secrets;
  for (const name of SECRET_NAMES) {
    try {
      out[name] = readFileSync(join(dir, name), 'utf8').trim();
    } catch {
      out[name] = '';
    }
  }
  return out;
}

/**
 * Configuração efetiva: as ligações externas (modo importar) sobrepõem os URLs e chaves do
 * stack do compose. Todo o resto do código usa só esta configuração.
 */
export function applyConnections(
  config: Config,
  secrets: Secrets,
  conns: Connections,
): { config: Config; secrets: Secrets } {
  const c = { ...config };
  const s = { ...secrets };
  const url = (u: string) => u.replace(/\/+$/, '');
  if (conns.sonarr) {
    c.MEDIASTACK_SONARR_URL = url(conns.sonarr.url);
    s['sonarr.key'] = conns.sonarr.key;
  }
  if (conns.radarr) {
    c.MEDIASTACK_RADARR_URL = url(conns.radarr.url);
    s['radarr.key'] = conns.radarr.key;
  }
  if (conns.prowlarr) {
    c.MEDIASTACK_PROWLARR_URL = url(conns.prowlarr.url);
    s['prowlarr.key'] = conns.prowlarr.key;
  }
  if (conns.bazarr) {
    c.MEDIASTACK_BAZARR_URL = url(conns.bazarr.url);
    s['bazarr.key'] = conns.bazarr.key;
  }
  if (conns.qbittorrent) {
    c.MEDIASTACK_QBITTORRENT_URL = url(conns.qbittorrent.url);
    c.MEDIASTACK_QBITTORRENT_USER = conns.qbittorrent.username ?? 'admin';
    s['qbittorrent.password'] = conns.qbittorrent.key;
  }
  if (conns.seerr) c.MEDIASTACK_SEERR_URL = url(conns.seerr.url);
  return { config: c, secrets: s };
}

import type { Config } from './config.js';

export type ServiceId =
  'seerr' | 'sonarr' | 'radarr' | 'bazarr' | 'prowlarr' | 'qbittorrent' | 'byparr';

export interface ServiceDef {
  id: ServiceId;
  name: string;
  url: string;
  /** Caminho sem autenticação usado para verificar se o serviço responde. */
  probePath: string;
}

export interface ServiceStatus {
  id: ServiceId;
  name: string;
  state: 'up' | 'down';
  latencyMs: number | null;
  detail?: string;
}

export const serviceDefs = (c: Config): ServiceDef[] => [
  { id: 'seerr', name: 'Seerr', url: c.CAIS_SEERR_URL, probePath: '/api/v1/status' },
  { id: 'sonarr', name: 'Sonarr', url: c.CAIS_SONARR_URL, probePath: '/ping' },
  { id: 'radarr', name: 'Radarr', url: c.CAIS_RADARR_URL, probePath: '/ping' },
  { id: 'bazarr', name: 'Bazarr', url: c.CAIS_BAZARR_URL, probePath: '/' },
  { id: 'prowlarr', name: 'Prowlarr', url: c.CAIS_PROWLARR_URL, probePath: '/ping' },
  { id: 'qbittorrent', name: 'qBittorrent', url: c.CAIS_QBITTORRENT_URL, probePath: '/' },
  { id: 'byparr', name: 'Byparr', url: c.CAIS_BYPARR_URL, probePath: '/' },
];

/** Um serviço está "up" se responder com qualquer estado < 500 (redirects e 401 contam). */
export async function probe(
  def: ServiceDef,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 3000,
): Promise<ServiceStatus> {
  const started = performance.now();
  try {
    const res = await fetchImpl(new URL(def.probePath, def.url), {
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
    const latencyMs = Math.round(performance.now() - started);
    if (res.status >= 500) {
      return { id: def.id, name: def.name, state: 'down', latencyMs, detail: `HTTP ${res.status}` };
    }
    return { id: def.id, name: def.name, state: 'up', latencyMs };
  } catch (err) {
    return {
      id: def.id,
      name: def.name,
      state: 'down',
      latencyMs: null,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

export const probeAll = (defs: ServiceDef[], fetchImpl?: typeof fetch) =>
  Promise.all(defs.map((d) => probe(d, fetchImpl)));

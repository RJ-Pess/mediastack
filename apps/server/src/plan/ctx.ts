import type { Config } from '../config.js';
import { readSecrets } from '../init/secrets.js';
import { ArrClient } from '../reconcile/arr.js';
import { BazarrClient } from '../reconcile/bazarr.js';
import { QbitClient } from '../reconcile/qbit.js';

export interface Ctx {
  sonarr: ArrClient;
  radarr: ArrClient;
  prowlarr: ArrClient;
  bazarr: BazarrClient;
  qbit: QbitClient;
}

export function buildCtx(c: Config, fetchImpl?: typeof fetch): Ctx {
  const s = readSecrets(c.CAIS_SECRETS_DIR);
  return {
    sonarr: new ArrClient('Sonarr', c.CAIS_SONARR_URL, s['sonarr.key'], 'v3', fetchImpl),
    radarr: new ArrClient('Radarr', c.CAIS_RADARR_URL, s['radarr.key'], 'v3', fetchImpl),
    prowlarr: new ArrClient('Prowlarr', c.CAIS_PROWLARR_URL, s['prowlarr.key'], 'v1', fetchImpl),
    bazarr: new BazarrClient(c.CAIS_BAZARR_URL, s['bazarr.key'], fetchImpl),
    qbit: new QbitClient(c.CAIS_QBITTORRENT_URL, 'cais', s['qbittorrent.password'], fetchImpl),
  };
}

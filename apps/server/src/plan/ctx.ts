import type { Config } from '../config.js';
import { ArrClient } from '../reconcile/arr.js';
import { BazarrClient } from '../reconcile/bazarr.js';
import { QbitClient } from '../reconcile/qbit.js';
import { SeerrClient } from '../reconcile/seerr.js';
import type { Secrets } from '../connections.js';

export interface Ctx {
  sonarr: ArrClient;
  radarr: ArrClient;
  prowlarr: ArrClient;
  bazarr: BazarrClient;
  qbit: QbitClient;
  /** `null` até o Seerr ser ligado ao Jellyfin. */
  seerr: SeerrClient | null;
  config: Config;
  secrets: Secrets;
  recyclarrDir: string;
  /** Segredo de terceiros guardado cifrado (ex.: webhook de notificações). */
  getSecret: (name: string) => string | undefined;
}

export interface Effective {
  config: Config;
  secrets: Secrets;
}

/** Contexto de clientes sobre a configuração efetiva (stack do compose ou ligações externas). */
export function buildCtx(
  eff: Effective,
  fetchImpl?: typeof fetch,
  seerrKey?: string,
  getSecret: (name: string) => string | undefined = () => undefined,
): Ctx {
  const { config: c, secrets: s } = eff;
  return {
    sonarr: new ArrClient('Sonarr', c.MEDIASTACK_SONARR_URL, s['sonarr.key'], 'v3', fetchImpl),
    radarr: new ArrClient('Radarr', c.MEDIASTACK_RADARR_URL, s['radarr.key'], 'v3', fetchImpl),
    prowlarr: new ArrClient(
      'Prowlarr',
      c.MEDIASTACK_PROWLARR_URL,
      s['prowlarr.key'],
      'v1',
      fetchImpl,
    ),
    bazarr: new BazarrClient(c.MEDIASTACK_BAZARR_URL, s['bazarr.key'], fetchImpl),
    qbit: new QbitClient(
      c.MEDIASTACK_QBITTORRENT_URL,
      c.MEDIASTACK_QBITTORRENT_USER,
      s['qbittorrent.password'],
      fetchImpl,
    ),
    seerr: seerrKey ? new SeerrClient(c.MEDIASTACK_SEERR_URL, seerrKey, fetchImpl) : null,
    config: c,
    secrets: s,
    recyclarrDir: c.MEDIASTACK_RECYCLARR_DIR,
    getSecret,
  };
}

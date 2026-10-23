import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().int().default(8080),
  MEDIASTACK_WEB_DIR: z.string().default('web'),
  MEDIASTACK_DATA_DIR: z.string().default('/config'),
  MEDIASTACK_SECRETS_DIR: z.string().default('/run/mediastack'),
  MEDIASTACK_CONFIG_ROOT: z.string().default('/configs'),
  PUID: z.coerce.number().int().optional(),
  PGID: z.coerce.number().int().optional(),
  MEDIASTACK_RECYCLARR_SCRIPT: z.string().default('/app/recyclarr/sync.sh'),
  MEDIASTACK_RECYCLARR_DIR: z.string().default('/recyclarr'),
  /** Onde o MediaStack vê a raiz de dados (os containers veem-na em /data). */
  MEDIASTACK_DATA_MOUNT: z.string().default('/data'),
  MEDIASTACK_DATA_ROOT: z.string().optional(),
  MEDIASTACK_TORRENT_PORT: z.coerce.number().int().default(6882),
  MEDIASTACK_SEERR_URL: z.string().default('http://seerr:5055'),
  MEDIASTACK_SONARR_URL: z.string().default('http://sonarr:8989'),
  MEDIASTACK_RADARR_URL: z.string().default('http://radarr:7878'),
  MEDIASTACK_BAZARR_URL: z.string().default('http://bazarr:6767'),
  MEDIASTACK_PROWLARR_URL: z.string().default('http://prowlarr:9696'),
  MEDIASTACK_QBITTORRENT_USER: z.string().default('mediastack'),
  MEDIASTACK_QBITTORRENT_URL: z.string().default('http://qbittorrent:8080'),
  MEDIASTACK_BYPARR_URL: z.string().default('http://byparr:8191'),
});

export type Config = z.infer<typeof schema>;

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): Config => schema.parse(env);

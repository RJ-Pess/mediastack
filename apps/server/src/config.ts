import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().int().default(8080),
  CAIS_WEB_DIR: z.string().default('web'),
  CAIS_DATA_DIR: z.string().default('/config'),
  CAIS_SECRETS_DIR: z.string().default('/run/cais'),
  CAIS_CONFIG_ROOT: z.string().default('/configs'),
  PUID: z.coerce.number().int().optional(),
  PGID: z.coerce.number().int().optional(),
  CAIS_DATA_ROOT: z.string().optional(),
  CAIS_TORRENT_PORT: z.coerce.number().int().default(6882),
  CAIS_SEERR_URL: z.string().default('http://seerr:5055'),
  CAIS_SONARR_URL: z.string().default('http://sonarr:8989'),
  CAIS_RADARR_URL: z.string().default('http://radarr:7878'),
  CAIS_BAZARR_URL: z.string().default('http://bazarr:6767'),
  CAIS_PROWLARR_URL: z.string().default('http://prowlarr:9696'),
  CAIS_QBITTORRENT_URL: z.string().default('http://qbittorrent:8080'),
  CAIS_BYPARR_URL: z.string().default('http://byparr:8191'),
});

export type Config = z.infer<typeof schema>;

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): Config => schema.parse(env);

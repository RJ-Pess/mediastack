import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { runInit } from './init/index.js';

const config = loadConfig();

if (process.argv[2] === 'init') {
  runInit({
    secretsDir: config.CAIS_SECRETS_DIR,
    configRoot: config.CAIS_CONFIG_ROOT,
    torrentPort: config.CAIS_TORRENT_PORT,
    dataRoot: config.CAIS_DATA_ROOT,
    owner:
      config.PUID !== undefined && config.PGID !== undefined
        ? { uid: config.PUID, gid: config.PGID }
        : undefined,
  });
} else {
  const app = await buildApp(config);
  await app.listen({ port: config.PORT, host: '0.0.0.0' });
  void app.reconciler.runWithRetry();
}

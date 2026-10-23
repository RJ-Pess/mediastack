import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { checkHardlink } from './storage/hardlink.js';
import { runInit } from './init/index.js';

const config = loadConfig();

if (process.argv[2] === 'hardlink-check') {
  // Usado pelo teste de integração para simular mounts partidos.
  const r = await checkHardlink(process.argv[3] ?? '', process.argv[4] ?? '');
  console.log(JSON.stringify(r));
  process.exit(r.ok ? 0 : 1);
}

if (process.argv[2] === 'init') {
  runInit({
    secretsDir: config.MEDIASTACK_SECRETS_DIR,
    configRoot: config.MEDIASTACK_CONFIG_ROOT,
    torrentPort: config.MEDIASTACK_TORRENT_PORT,
    dataRoot: config.MEDIASTACK_DATA_ROOT,
    owner:
      config.PUID !== undefined && config.PGID !== undefined
        ? { uid: config.PUID, gid: config.PGID }
        : undefined,
  });
} else {
  const app = await buildApp(config);
  await app.listen({ port: config.PORT, host: '0.0.0.0' });
  void app.reconciler.runWithRetry().then(async () => {
    // Primeira aplicação do estado desejado por omissão; daí em diante, drift periódico.
    await app.planner.bootstrap();
    setInterval(() => void app.planner.checkDrift().catch(() => undefined), 5 * 60_000);
  });
}

import { chownSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { initBazarr } from './bazarr.js';
import { initQbittorrent } from './qbittorrent.js';
import { ensureSecrets } from './secrets.js';

export interface InitOptions {
  /** Volume partilhado com os segredos (montado só-leitura nos outros containers). */
  secretsDir: string;
  /** Raiz das configs dos serviços, um subdiretório por serviço. */
  configRoot: string;
  torrentPort: number;
  /** Raiz de dados montada no init (mesmo caminho interno `/data` dos outros containers). */
  dataRoot?: string;
  /** uid/gid a atribuir aos ficheiros criados (o init corre como root). */
  owner?: { uid: number; gid: number };
}

function chownTree(path: string, uid: number, gid: number): void {
  chownSync(path, uid, gid);
  if (statSync(path).isDirectory()) {
    for (const f of readdirSync(path)) chownTree(join(path, f), uid, gid);
  }
}

export function runInit(o: InitOptions): void {
  const s = ensureSecrets(o.secretsDir);
  const dataDir = join(o.configRoot, 'mediastack', 'data');
  mkdirSync(dataDir, { recursive: true });
  // Pasta partilhada com o Recyclarr (pedidos de sincronização e resultado).
  const recyclarrDir = join(o.configRoot, 'mediastack', 'recyclarr');
  mkdirSync(recyclarrDir, { recursive: true });
  // O Seerr corre como utilizador não-root e não cria a pasta de config por si.
  mkdirSync(join(o.configRoot, 'seerr'), { recursive: true });
  const dataDirs = o.dataRoot
    ? ['torrents/tv', 'torrents/movies', 'media/tv', 'media/movies'].map((d) =>
        join(o.dataRoot!, d),
      )
    : [];
  for (const d of dataDirs) mkdirSync(d, { recursive: true });
  const log = (msg: string) => console.log(`[mediastack-init] ${msg}`);

  const q = initQbittorrent(join(o.configRoot, 'qbittorrent'), {
    username: 'mediastack',
    password: s['qbittorrent.password'],
    torrentPort: o.torrentPort,
    savePath: '/data/torrents',
    categories: { tv: '/data/torrents/tv', movies: '/data/torrents/movies' },
  });
  log(q ? 'qBittorrent.conf criado' : 'qBittorrent.conf já existe, mantido');

  const b = initBazarr(join(o.configRoot, 'bazarr'), s['bazarr.key']);
  log(b ? 'Bazarr config.yaml criado' : 'Bazarr config.yaml já existe, mantido');

  if (o.owner) {
    for (const d of ownedDirs(o)) chownTree(d, o.owner.uid, o.owner.gid);
    // Só as pastas-base: não percorre a biblioteca existente.
    for (const d of dataDirs) chownSync(d, o.owner.uid, o.owner.gid);
  }
}

/**
 * Pastas de configuração que os outros containers (não-root, PUID:PGID) têm de poder escrever.
 * Qualquer pasta criada pelo init e usada por um container não-root TEM de estar aqui:
 * no Linux, uma pasta que fique de root faz o container falhar a arrancar.
 */
export function ownedDirs(o: Pick<InitOptions, 'secretsDir' | 'configRoot'>): string[] {
  return [
    join(o.configRoot, 'mediastack', 'data'),
    join(o.configRoot, 'mediastack', 'recyclarr'),
    o.secretsDir,
    join(o.configRoot, 'qbittorrent'),
    join(o.configRoot, 'bazarr'),
    join(o.configRoot, 'seerr'),
  ];
}

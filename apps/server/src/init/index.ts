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
  const dataDir = join(o.configRoot, 'cais', 'data');
  mkdirSync(dataDir, { recursive: true });
  const dataDirs = o.dataRoot
    ? ['torrents/tv', 'torrents/movies', 'media/tv', 'media/movies'].map((d) =>
        join(o.dataRoot!, d),
      )
    : [];
  for (const d of dataDirs) mkdirSync(d, { recursive: true });
  const log = (msg: string) => console.log(`[cais-init] ${msg}`);

  const q = initQbittorrent(join(o.configRoot, 'qbittorrent'), {
    username: 'cais',
    password: s['qbittorrent.password'],
    torrentPort: o.torrentPort,
    savePath: '/data/torrents',
    categories: { tv: '/data/torrents/tv', movies: '/data/torrents/movies' },
  });
  log(q ? 'qBittorrent.conf criado' : 'qBittorrent.conf já existe, mantido');

  const b = initBazarr(join(o.configRoot, 'bazarr'), s['bazarr.key']);
  log(b ? 'Bazarr config.yaml criado' : 'Bazarr config.yaml já existe, mantido');

  if (o.owner) {
    for (const d of [
      o.secretsDir,
      join(o.configRoot, 'qbittorrent'),
      join(o.configRoot, 'bazarr'),
    ]) {
      chownTree(d, o.owner.uid, o.owner.gid);
    }
    // Só as pastas-base: não percorre a biblioteca existente.
    for (const d of dataDirs) chownSync(d, o.owner.uid, o.owner.gid);
  }
}

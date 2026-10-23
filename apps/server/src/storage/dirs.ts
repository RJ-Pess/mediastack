import { mkdirSync } from 'node:fs';
import { posix } from 'node:path';

/** Raiz de dados como os containers a veem (igual em todos, para haver hardlinks). */
export const CONTAINER_DATA = '/data';

/** Caminho de container → caminho onde o MediaStack vê a mesma pasta. */
export const physicalPath = (mount: string, p: string) =>
  posix.join(mount, posix.normalize(p).slice(CONTAINER_DATA.length));

/**
 * Cria as pastas escolhidas na UI que ainda não existam. Os caminhos são os dos containers
 * (têm de ficar dentro de `/data`); `mount` é onde o MediaStack vê essa mesma raiz.
 * Corre como PUID:PGID, por isso as pastas ficam com o dono certo.
 */
export function ensureDirs(mount: string, paths: string[]): string[] {
  const created: string[] = [];
  for (const raw of paths) {
    const p = posix.normalize(raw);
    if (p !== CONTAINER_DATA && !p.startsWith(`${CONTAINER_DATA}/`)) {
      throw new Error(`o caminho "${raw}" tem de estar dentro de ${CONTAINER_DATA}`);
    }
    const physical = posix.join(mount, p.slice(CONTAINER_DATA.length));
    try {
      if (mkdirSync(physical, { recursive: true }) !== undefined) created.push(p);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      throw new Error(
        code === 'EACCES' || code === 'EPERM'
          ? `sem permissão para criar "${p}": confirma que PUID/PGID são donos da raiz de dados`
          : `não foi possível criar "${p}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return created;
}

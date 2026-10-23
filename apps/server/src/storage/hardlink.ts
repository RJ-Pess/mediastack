import { randomBytes } from 'node:crypto';
import { link, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export type HardlinkResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'different_mounts' | 'unsupported' | 'not_writable' | 'inode_mismatch' | 'error';
      message: string;
    };

/**
 * Testa a sério se um hardlink de `from` para `to` funciona: cria um ficheiro em `from`,
 * liga-o em `to` e confirma que ambos partilham dispositivo e inode.
 */
export async function checkHardlink(from: string, to: string): Promise<HardlinkResult> {
  const id = `.cais-hl-${randomBytes(6).toString('hex')}`;
  const src = join(from, id);
  const dst = join(to, id);
  try {
    await writeFile(src, 'cais');
    await link(src, dst);
    const [a, b] = await Promise.all([stat(src), stat(dst)]);
    if (a.dev !== b.dev || a.ino !== b.ino) {
      return {
        ok: false,
        reason: 'inode_mismatch',
        message: 'o hardlink criou um ficheiro diferente',
      };
    }
    return { ok: true };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    const message = err instanceof Error ? err.message : String(err);
    if (code === 'EXDEV') {
      return {
        ok: false,
        reason: 'different_mounts',
        message: `${from} e ${to} estão em mounts diferentes: sem hardlinks (os imports vão copiar). Monta a raiz de dados num único volume.`,
      };
    }
    if (code === 'EPERM' || code === 'ENOTSUP' || code === 'EOPNOTSUPP' || code === 'EMLINK') {
      return {
        ok: false,
        reason: 'unsupported',
        message: `o sistema de ficheiros não suporta hardlinks (${code})`,
      };
    }
    if (code === 'EACCES' || code === 'EROFS' || code === 'ENOENT') {
      return {
        ok: false,
        reason: 'not_writable',
        message: `sem acesso de escrita a ${from} ou ${to} (${code})`,
      };
    }
    return { ok: false, reason: 'error', message };
  } finally {
    await Promise.allSettled([unlink(src), unlink(dst)]);
  }
}

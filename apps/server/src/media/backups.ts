import type { Ctx } from '../plan/ctx.js';

export interface BackupEntry {
  service: string;
  name: string;
  type: string;
  size: number;
  time: string;
}

const ARR = ['sonarr', 'radarr', 'prowlarr'] as const;

/** Backups nativos existentes em cada serviço, do mais recente para o mais antigo. */
export async function listBackups(ctx: Ctx): Promise<BackupEntry[]> {
  const lists = await Promise.all(
    ARR.map(async (service) => {
      try {
        return (
          await ctx[service].get<{ name: string; type: string; size: number; time: string }[]>(
            'system/backup',
          )
        ).map((b) => ({ service, name: b.name, type: b.type, size: b.size, time: b.time }));
      } catch {
        return [];
      }
    }),
  );
  return lists.flat().sort((a, b) => b.time.localeCompare(a.time));
}

/** Pede um backup agora a cada serviço (comando nativo `Backup`). */
export async function runBackups(
  ctx: Ctx,
): Promise<{ service: string; ok: boolean; error?: string }[]> {
  return Promise.all(
    ARR.map(async (service) => {
      try {
        await ctx[service].request('POST', 'command', { name: 'Backup' });
        return { service, ok: true };
      } catch (err) {
        return { service, ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }),
  );
}

import { parse, stringify } from 'yaml';
import { z } from 'zod';
import { defaultDesired, desiredSchema, type Desired } from './desired.js';

const FORMAT_VERSION = 1;

const documentSchema = z.object({
  mediastack: z.object({ version: z.literal(FORMAT_VERSION) }),
  desired: z.record(z.string(), z.unknown()),
  /** Segredos já cifrados com a chave do MediaStack de origem (opcional). */
  secrets: z.record(z.string(), z.string()).optional(),
});

const HEADER = `# Estado desejado do MediaStack / MediaStack desired state
# Importa em Definições → Backup e restauro. / Import it in Settings → Backup and restore.
`;

/** YAML legível. Os segredos só entram (cifrados) se `secrets` for passado. */
export function exportYaml(desired: Desired, secrets?: Record<string, string>): string {
  const doc: Record<string, unknown> = {
    mediastack: { version: FORMAT_VERSION },
    desired,
  };
  if (secrets && Object.keys(secrets).length) doc.secrets = secrets;
  return HEADER + stringify(doc, { lineWidth: 100 });
}

export interface Imported {
  desired: Desired;
  secrets: Record<string, string>;
}

/** Valida um YAML exportado. Campos em falta usam os valores por omissão. */
export function importYaml(text: string): Imported {
  let raw: unknown;
  try {
    raw = parse(text);
  } catch (err) {
    throw new Error(`YAML inválido: ${err instanceof Error ? err.message : String(err)}`);
  }
  const doc = documentSchema.safeParse(raw);
  if (!doc.success) throw new Error('ficheiro não é um export do MediaStack (versão 1)');
  const d = defaultDesired() as unknown as Record<string, unknown>;
  // Mescla secção a secção, para exports de versões anteriores continuarem válidos.
  for (const [k, v] of Object.entries(doc.data.desired)) {
    d[k] =
      typeof v === 'object' && v !== null && !Array.isArray(v) ? { ...(d[k] as object), ...v } : v;
  }
  const desired = desiredSchema.safeParse(d);
  if (!desired.success) {
    const i = desired.error.issues[0];
    throw new Error(`estado inválido em ${i?.path.join('.')}: ${i?.message}`);
  }
  return { desired: desired.data, secrets: doc.data.secrets ?? {} };
}

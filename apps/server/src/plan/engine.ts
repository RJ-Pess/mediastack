import type { ServiceId } from '../services.js';
import type { Ctx } from './ctx.js';
import type { Store } from './db.js';
import type { Desired } from './desired.js';
import { allFields, type AnyField } from './fields.js';

export interface Change {
  fieldId: string;
  service: ServiceId;
  section: string;
  label: string;
  before: unknown;
  after: unknown;
}

export interface PlanResult {
  changes: Change[];
  errors: { fieldId: string; service: ServiceId; error: string }[];
  checkedAt: string;
}

const same = (f: AnyField, want: unknown, have: unknown) =>
  f.equal ? f.equal(want, have) : JSON.stringify(want) === JSON.stringify(have);

/** Lê o estado real de cada serviço e devolve só o que difere do desejado. */
export async function plan(ctx: Ctx, desired: Desired): Promise<PlanResult> {
  const result: PlanResult = { changes: [], errors: [], checkedAt: new Date().toISOString() };
  await Promise.all(
    allFields(desired).map(async (f) => {
      const want = f.desired(desired);
      if (want === undefined) return;
      try {
        const have = await f.read(ctx);
        if (!same(f, want, have)) {
          result.changes.push({
            fieldId: f.id,
            service: f.service,
            section: f.section,
            label: f.label,
            before: have,
            after: want,
          });
        }
      } catch (err) {
        result.errors.push({
          fieldId: f.id,
          service: f.service,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }),
  );
  result.changes.sort((a, b) => a.fieldId.localeCompare(b.fieldId));
  return result;
}

export interface ApplyResult {
  applied: string[];
  failed: { fieldId: string; error: string }[];
}

/** Aplica o plan, campo a campo, e regista cada escrita na auditoria. */
export async function apply(
  ctx: Ctx,
  desired: Desired,
  store: Store,
  actor: string,
  only?: string[],
): Promise<ApplyResult> {
  const p = await plan(ctx, desired);
  const changes = new Map(p.changes.map((c) => [c.fieldId, c]));
  const out: ApplyResult = { applied: [], failed: [] };
  // Segue a ordem de declaração dos campos (ex.: perfil de legendas antes do perfil por omissão).
  for (const f of allFields(desired)) {
    const c = changes.get(f.id);
    if (!c || (only && !only.includes(c.fieldId))) continue;
    try {
      await retry(() => f.write(ctx, c.after));
      store.addAudit({
        actor,
        fieldId: c.fieldId,
        service: c.service,
        before: c.before,
        after: c.after,
        status: 'ok',
        error: null,
      });
      out.applied.push(c.fieldId);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      store.addAudit({
        actor,
        fieldId: c.fieldId,
        service: c.service,
        before: c.before,
        after: c.after,
        status: 'error',
        error,
      });
      out.failed.push({ fieldId: c.fieldId, error });
    }
  }
  return out;
}

async function retry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= attempts) throw err;
      await new Promise((r) => setTimeout(r, 500 * i));
    }
  }
}

/** Trata o valor real como novo estado desejado para este campo ("adotar a alteração"). */
export async function adopt(ctx: Ctx, desired: Desired, fieldId: string): Promise<Desired> {
  const f = allFields(desired).find((x) => x.id === fieldId);
  if (!f) throw new Error(`campo desconhecido: ${fieldId}`);
  return f.adopt(desired, await f.read(ctx));
}

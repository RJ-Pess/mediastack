import type { Config } from '../config.js';
import { buildCtx, type Ctx } from './ctx.js';
import { Store } from './db.js';
import { adopt, apply, plan, type PlanResult } from './engine.js';
import { desiredSchema, type Desired } from './desired.js';

/** Junta estado desejado, plan/apply, auditoria e deteção periódica de drift. */
export function createPlanService(config: Config, ctxOverride?: Ctx, fetchImpl?: typeof fetch) {
  const store = new Store(`${config.CAIS_DATA_DIR}/cais.db`);
  const ctx = () => ctxOverride ?? buildCtx(config, fetchImpl);
  let lastDrift: PlanResult | null = null;
  /** O drift só faz sentido depois do primeiro apply; antes tudo seria "diferença". */
  let applied = false;

  return {
    store,
    getDesired: () => store.getDesired(),
    setDesired: (raw: unknown): Desired => {
      const d = desiredSchema.parse(raw);
      store.setDesired(d);
      return d;
    },
    plan: () => plan(ctx(), store.getDesired()),
    async apply(actor: string, only?: string[]) {
      const r = await apply(ctx(), store.getDesired(), store, actor, only);
      applied = true;
      lastDrift = null;
      return r;
    },
    async adopt(fieldId: string): Promise<Desired> {
      const d = await adopt(ctx(), store.getDesired(), fieldId);
      store.setDesired(d);
      return d;
    },
    async checkDrift(): Promise<PlanResult | null> {
      if (!applied) return null;
      lastDrift = await plan(ctx(), store.getDesired());
      return lastDrift;
    },
    getDrift: () => lastDrift,
    /** Primeiro arranque: grava e aplica o estado por omissão. Depois: só liga o drift. */
    async bootstrap() {
      if (store.hasDesired()) {
        applied = true;
        return null;
      }
      store.setDesired(store.getDesired());
      return this.apply('boot');
    },
  };
}

export type PlanService = ReturnType<typeof createPlanService>;

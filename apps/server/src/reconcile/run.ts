import type { Config } from '../config.js';
import { safeReadSecrets } from '../connections.js';
import type { Effective } from '../plan/ctx.js';
import { wireServices, type StepResult } from './wiring.js';

export interface ReconcileState {
  running: boolean;
  lastRun: string | null;
  steps: StepResult[];
  error: string | null;
}

export function createReconciler(
  config: Config,
  fetchImpl?: typeof fetch,
  getSeerrKey: () => string | undefined = () => undefined,
  getEffective: () => Effective = () => ({
    config,
    secrets: safeReadSecrets(config.MEDIASTACK_SECRETS_DIR),
  }),
  /** Em modo importar o MediaStack não cria nem altera nada sozinho (só no apply). */
  isExternal: () => boolean = () => false,
) {
  const state: ReconcileState = { running: false, lastRun: null, steps: [], error: null };

  let current: Promise<ReconcileState> | null = null;

  async function execute(): Promise<ReconcileState> {
    state.running = true;
    try {
      if (isExternal()) {
        state.steps = [{ step: 'Modo importar: sem ligações automáticas', result: 'skipped' }];
        state.error = null;
        return state;
      }
      const eff = getEffective();
      state.steps = await wireServices(eff.config, eff.secrets, fetchImpl, getSeerrKey());
      state.error = null;
    } catch (err) {
      state.error = err instanceof Error ? err.message : String(err);
    } finally {
      state.running = false;
      state.lastRun = new Date().toISOString();
    }
    return state;
  }

  /**
   * Corre um reconcile. Se já houver um a correr, espera por ele e corre outro a seguir:
   * o pedido pode ter sido feito porque algo mudou (ex.: o Seerr acabou de ser ligado ao
   * Jellyfin) e a execução em curso já não o vê.
   */
  async function run(): Promise<ReconcileState> {
    const previous = current;
    const next = (async () => {
      if (previous) await previous.catch(() => undefined);
      return execute();
    })();
    current = next;
    try {
      return await next;
    } finally {
      if (current === next) current = null;
    }
  }

  /** Tenta até os serviços estarem prontos (backoff linear, máx. ~2 min). */
  async function runWithRetry(attempts = 12, delayMs = 10_000): Promise<ReconcileState> {
    for (let i = 0; i < attempts; i++) {
      await run();
      if (!state.error) break;
      await new Promise((r) => setTimeout(r, delayMs));
    }
    return state;
  }

  return { state, run, runWithRetry };
}

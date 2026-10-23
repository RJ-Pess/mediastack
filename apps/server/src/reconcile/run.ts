import type { Config } from '../config.js';
import { readSecrets } from '../init/secrets.js';
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
) {
  const state: ReconcileState = { running: false, lastRun: null, steps: [], error: null };

  async function run(): Promise<ReconcileState> {
    if (state.running) return state;
    state.running = true;
    try {
      state.steps = await wireServices(
        config,
        readSecrets(config.CAIS_SECRETS_DIR),
        fetchImpl,
        getSeerrKey(),
      );
      state.error = null;
    } catch (err) {
      state.error = err instanceof Error ? err.message : String(err);
    } finally {
      state.running = false;
      state.lastRun = new Date().toISOString();
    }
    return state;
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

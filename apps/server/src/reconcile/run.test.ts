import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';
import { ensureSecrets } from '../init/secrets.js';
import { createReconciler } from './run.js';

describe('createReconciler', () => {
  it('um pedido feito durante uma execução corre outra a seguir', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'mediastack-')), 's');
    ensureSecrets(dir);
    let executions = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const rec = createReconciler(
      loadConfig({ MEDIASTACK_SECRETS_DIR: dir }),
      (async () => {
        await gate; // segura a 1.ª execução dentro do fetch
        throw new Error('sem rede');
      }) as unknown as typeof fetch,
      () => (++executions, undefined), // chamado uma vez por execução
    );
    const first = rec.run();
    const second = rec.run(); // pedido enquanto a 1.ª ainda corre
    release();
    await Promise.all([first, second]);
    expect(executions).toBe(2);
  });
});

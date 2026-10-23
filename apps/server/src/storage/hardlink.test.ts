import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkHardlink } from './hardlink.js';

describe('checkHardlink', () => {
  it('funciona dentro do mesmo sistema de ficheiros', async () => {
    const root = mkdtempSync(join(tmpdir(), 'hl-'));
    mkdirSync(join(root, 'a'));
    mkdirSync(join(root, 'b'));
    expect(await checkHardlink(join(root, 'a'), join(root, 'b'))).toEqual({ ok: true });
  });

  it('avisa quando uma pasta não existe', async () => {
    const root = mkdtempSync(join(tmpdir(), 'hl-'));
    const r = await checkHardlink(root, join(root, 'nao-existe'));
    expect(r).toMatchObject({ ok: false, reason: 'not_writable' });
  });
});

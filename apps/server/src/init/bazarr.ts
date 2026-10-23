import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** O Bazarr preenche o resto dos valores por omissão ao arrancar. */
export function initBazarr(configDir: string, apiKey: string): boolean {
  const dir = join(configDir, 'config');
  const file = join(dir, 'config.yaml');
  if (existsSync(file)) return false;
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, `---\nanalytics:\n  enabled: false\nauth:\n  apikey: ${apiKey}\n`);
  return true;
}

import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const WORK = process.env.CAIS_IT_DIR ?? `${process.env.HOME}/cais-it`;
const secret = (name: string) => readFileSync(`${WORK}/cfg/cais/secrets/${name}`, 'utf8').trim();
const RADARR = 'http://localhost:17878';
const PROWLARR = 'http://localhost:19696';

async function arr<T>(base: string, ver: string, key: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${base}/api/${ver}/${path}`, {
    ...init,
    headers: { 'X-Api-Key': key, 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

/** Regista o indexador falso no Prowlarr (o sync leva-o ao Radarr). Sem conteúdo real. */
async function addMockIndexer() {
  const key = secret('prowlarr.key');
  const schema = await arr<{ implementation: string; fields: { name: string; value?: unknown }[] }[]>(PROWLARR, 'v1', key, 'indexer/schema');
  const torznab = schema.find((s) => s.implementation === 'Torznab')!;
  const profiles = await arr<{ id: number }[]>(PROWLARR, 'v1', key, 'appprofile');
  const values: Record<string, unknown> = { baseUrl: 'http://mock-indexer:9000', apiPath: '/api', apiKey: 'mock', categories: [2000, 2040, 5000, 5040] };
  await arr(PROWLARR, 'v1', key, 'indexer?forceSave=true', {
    method: 'POST',
    body: JSON.stringify({
      ...torznab, name: 'Mock', enable: true, appProfileId: profiles[0]!.id, protocol: 'torrent', priority: 25, tags: [],
      fields: torznab.fields.map((f) => (f.name in values ? { ...f, value: values[f.name] } : f)),
    }),
  });
}

test('wizard completo e pedido de um filme que aparece na fila do Radarr', async ({ page }) => {
  // --- Wizard ---
  await page.goto('/');
  await page.getByLabel('Utilizador').fill('admin');
  await page.getByLabel('Palavra-passe').fill('password-de-teste-123');
  await page.getByRole('button', { name: 'Continuar' }).click();

  await expect(page.getByRole('heading', { name: 'Onde ficam os ficheiros?' })).toBeVisible();
  await page.getByRole('button', { name: 'Testar hardlinks' }).click();
  await expect(page.getByText('Hardlinks OK: /data/torrents → /data/media/tv')).toBeVisible();
  await expect(page.getByText('Hardlinks OK: /data/torrents → /data/media/movies')).toBeVisible();
  await page.getByRole('button', { name: 'Continuar' }).click();

  await expect(page.getByRole('heading', { name: 'Idiomas das legendas' })).toBeVisible();
  await page.getByRole('button', { name: 'Continuar' }).click();

  await expect(page.getByRole('heading', { name: 'Ligar ao Jellyfin' })).toBeVisible();
  await page.getByLabel('Endereço do Jellyfin').fill('jellyfin');
  await page.getByLabel('Utilizador').fill('admin');
  await page.getByLabel('Palavra-passe').fill('jf-password-123');
  await page.getByRole('button', { name: 'Ligar', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Aplicar a configuração' })).toBeVisible();
  await page.getByRole('button', { name: 'Aplicar', exact: true }).click();
  await page.getByRole('button', { name: 'Concluir' }).click();

  // --- Painel: os 7 serviços em verde ---
  await expect(page.getByRole('heading', { name: 'Início' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Em ordem' })).toHaveCount(7, { timeout: 30_000 });

  // --- Indexador falso (via API do Prowlarr) e espera pelo sync para o Radarr ---
  await addMockIndexer();
  await expect
    .poll(async () => (await arr<{ name: string }[]>(RADARR, 'v3', secret('radarr.key'), 'indexer')).length, { timeout: 60_000 })
    .toBeGreaterThan(0);

  // --- Pedir pelo ⌘K ---
  await page.keyboard.press('Control+K');
  await page.getByLabel('Pesquisar filmes e séries').fill('Night of the Living Dead');
  const hit = page.getByRole('dialog').locator('li', { hasText: '1968' }).filter({ has: page.getByRole('button', { name: 'Pedir' }) }).first();
  await expect(hit).toBeVisible({ timeout: 30_000 });
  await hit.getByRole('button', { name: 'Pedir' }).click();

  // --- Aparece na fila do Radarr (e na página Atividade) ---
  await expect
    .poll(async () => (await arr<{ totalRecords: number }>(RADARR, 'v3', secret('radarr.key'), 'queue')).totalRecords, { timeout: 4 * 60_000, intervals: [5_000] })
    .toBeGreaterThan(0);
  await page.keyboard.press('Escape');
  await page.getByRole('link', { name: 'Atividade' }).first().click();
  await expect(page.getByText(/Night\.of\.the\.Living\.Dead/).first()).toBeVisible({ timeout: 30_000 });
});

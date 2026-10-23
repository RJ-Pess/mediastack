import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  timeout: 6 * 60_000,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.CAIS_URL ?? 'http://localhost:18088',
    locale: 'pt-PT',
    trace: 'retain-on-failure',
  },
});

import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  expectedProfiles,
  readRequestedQuality,
  readSyncStatus,
  renderRequest,
  requestSync,
} from './recyclarr.js';

const links = [
  { url: 'http://radarr:7878', key: 'rk' },
  { url: 'http://sonarr:8989', key: 'sk' },
] as const;

describe('recyclarr', () => {
  it('traduz a escolha de qualidade nos perfis TRaSH esperados', () => {
    expect(expectedProfiles('1080p', 'radarr')).toEqual(['HD Bluray + WEB']);
    expect(expectedProfiles('4k', 'sonarr')).toEqual(['WEB-2160p']);
    expect(expectedProfiles('both', 'radarr')).toEqual(['HD Bluray + WEB', 'UHD Bluray + WEB']);
  });

  it('escreve o pedido (0600), cria o gatilho e consegue lê-lo de volta', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cais-rcl-'));
    expect(readRequestedQuality(dir)).toBeNull();
    expect(readSyncStatus(dir).status).toBe('never');

    requestSync(dir, renderRequest('both', links[0], links[1]));
    expect(readRequestedQuality(dir)).toBe('both');
    expect(readFileSync(join(dir, 'request.env'), 'utf8')).toContain(
      'RADARR_TEMPLATES="hd-bluray-web uhd-bluray-web"',
    );
    expect(statSync(join(dir, 'request.env')).mode & 0o777).toBe(0o600);
    expect(readSyncStatus(dir).status).toBe('pending'); // gatilho por consumir
  });

  it('lê o resultado da última sincronização', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cais-rcl-'));
    writeFileSync(join(dir, 'last-sync.txt'), '2026-10-23T21:00:00Z ok\n');
    expect(readSyncStatus(dir)).toEqual({ at: '2026-10-23T21:00:00Z', status: 'ok' });
    writeFileSync(join(dir, 'last-sync.txt'), '2026-10-23T21:05:00Z error\n');
    expect(readSyncStatus(dir).status).toBe('error');
  });
});

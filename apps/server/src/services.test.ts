import { describe, expect, it } from 'vitest';
import { probe, type ServiceDef } from './services.js';

const def: ServiceDef = {
  id: 'sonarr',
  name: 'Sonarr',
  url: 'http://sonarr:8989',
  probePath: '/ping',
};

describe('probe', () => {
  it('marca up com 200', async () => {
    const r = await probe(def, async () => new Response('{}', { status: 200 }));
    expect(r.state).toBe('up');
  });
  it('trata 401 como up', async () => {
    const r = await probe(def, async () => new Response('', { status: 401 }));
    expect(r.state).toBe('up');
  });
  it('marca down com 503', async () => {
    const r = await probe(def, async () => new Response('', { status: 503 }));
    expect(r).toMatchObject({ state: 'down', detail: 'HTTP 503' });
  });
  it('marca down quando a ligação falha', async () => {
    const r = await probe(def, async () => {
      throw new Error('ECONNREFUSED');
    });
    expect(r).toMatchObject({ state: 'down', latencyMs: null, detail: 'ECONNREFUSED' });
  });
});

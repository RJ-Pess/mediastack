import type { ArrClient, ArrResource } from '../reconcile/arr.js';

export interface InstalledIndexer {
  id: number;
  name: string;
  enable: boolean;
  privacy: string;
  protocol: string;
}

export interface AvailableIndexer {
  definitionName: string;
  name: string;
  language: string;
  protocol: string;
  description: string;
}

interface IndexerResource extends ArrResource {
  id: number;
  enable: boolean;
  privacy: string;
  protocol: string;
  definitionName?: string;
  appProfileId?: number;
  language?: string;
  description?: string;
}

const SCHEMA_TTL_MS = 10 * 60_000;
let schemaCache: { at: number; list: IndexerResource[] } | null = null;

/** O schema do Prowlarr tem ~650 definições; guardamos 10 min em memória. */
async function schema(p: ArrClient): Promise<IndexerResource[]> {
  if (!schemaCache || Date.now() - schemaCache.at > SCHEMA_TTL_MS) {
    schemaCache = { at: Date.now(), list: await p.get<IndexerResource[]>('indexer/schema') };
  }
  return schemaCache.list;
}

export const resetIndexerSchemaCache = () => (schemaCache = null);

export async function listIndexers(p: ArrClient) {
  const [installed, defs] = await Promise.all([p.get<IndexerResource[]>('indexer'), schema(p)]);
  const have = new Set(installed.map((i) => i.name.toLowerCase()));
  return {
    installed: installed.map((i): InstalledIndexer => ({
      id: i.id,
      name: i.name,
      enable: i.enable,
      privacy: i.privacy,
      protocol: i.protocol,
    })),
    // Só públicos (sem credenciais); os privados fazem-se na UI nativa do Prowlarr.
    available: defs
      .filter(
        (d) =>
          d.implementation === 'Cardigann' &&
          d.privacy === 'public' &&
          d.definitionName &&
          !have.has(d.name.toLowerCase()),
      )
      .map((d): AvailableIndexer => ({
        definitionName: d.definitionName!,
        name: d.name,
        language: d.language ?? '',
        protocol: d.protocol,
        description: d.description ?? '',
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export async function addIndexer(p: ArrClient, definitionName: string): Promise<InstalledIndexer> {
  const def = (await schema(p)).find(
    (d) => d.definitionName === definitionName && d.privacy === 'public',
  );
  if (!def) throw new Error(`indexador público desconhecido: ${definitionName}`);
  const profile = (await p.get<{ id: number }[]>('appprofile'))[0];
  if (!profile) throw new Error('o Prowlarr não tem perfis de aplicação');
  // forceSave: não testa a ligação ao site (testa-se à parte, a pedido).
  const created = await p.request<IndexerResource>('POST', 'indexer?forceSave=true', {
    ...def,
    enable: true,
    appProfileId: profile.id,
  });
  return {
    id: created.id,
    name: created.name,
    enable: created.enable,
    privacy: created.privacy,
    protocol: created.protocol,
  };
}

export async function setIndexerEnabled(p: ArrClient, id: number, enable: boolean): Promise<void> {
  const cur = await p.get<IndexerResource>(`indexer/${id}`);
  if (cur.enable === enable) return;
  await p.request('PUT', `indexer/${id}?forceSave=true`, { ...cur, enable });
}

export async function testIndexer(
  p: ArrClient,
  id: number,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const cur = await p.get<IndexerResource>(`indexer/${id}`);
  try {
    await p.request('POST', 'indexer/test', cur);
    return { ok: true };
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    // O corpo de erro do Servarr é uma lista de { errorMessage }.
    const msgs = [...raw.matchAll(/"errorMessage":\s*"([^"]+)"/g)].map((m) => m[1]);
    return { ok: false, message: msgs.length ? msgs.join('; ') : raw };
  }
}

export async function removeIndexer(p: ArrClient, id: number): Promise<void> {
  await p.request('DELETE', `indexer/${id}`);
}

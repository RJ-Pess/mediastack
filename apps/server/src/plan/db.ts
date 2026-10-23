import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { defaultDesired, desiredSchema, type Desired } from './desired.js';

export interface AuditEntry {
  id: number;
  ts: string;
  actor: string;
  fieldId: string;
  service: string;
  before: unknown;
  after: unknown;
  status: 'ok' | 'error';
  error: string | null;
}

export class Store {
  private db: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS desired (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, actor TEXT NOT NULL,
        field_id TEXT NOT NULL, service TEXT NOT NULL, before TEXT, after TEXT,
        status TEXT NOT NULL, error TEXT
      );
    `);
  }

  hasDesired(): boolean {
    return this.db.prepare('SELECT 1 FROM desired WHERE id = 1').get() !== undefined;
  }

  getDesired(): Desired {
    const row = this.db.prepare('SELECT json FROM desired WHERE id = 1').get() as
      { json: string } | undefined;
    return row ? desiredSchema.parse(JSON.parse(row.json)) : defaultDesired();
  }

  setDesired(d: Desired): void {
    this.db
      .prepare(
        `INSERT INTO desired (id, json, updated_at) VALUES (1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`,
      )
      .run(JSON.stringify(d), new Date().toISOString());
  }

  addAudit(e: Omit<AuditEntry, 'id' | 'ts'>): void {
    this.db
      .prepare(
        'INSERT INTO audit (ts, actor, field_id, service, before, after, status, error) VALUES (?,?,?,?,?,?,?,?)',
      )
      .run(
        new Date().toISOString(),
        e.actor,
        e.fieldId,
        e.service,
        JSON.stringify(e.before ?? null),
        JSON.stringify(e.after ?? null),
        e.status,
        e.error,
      );
  }

  listAudit(limit = 100): AuditEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM audit ORDER BY id DESC LIMIT ?')
      .all(limit) as Record<string, string | number | null>[];
    return rows.map((r) => ({
      id: r.id as number,
      ts: r.ts as string,
      actor: r.actor as string,
      fieldId: r.field_id as string,
      service: r.service as string,
      before: JSON.parse((r.before as string) ?? 'null'),
      after: JSON.parse((r.after as string) ?? 'null'),
      status: r.status as 'ok' | 'error',
      error: r.error as string | null,
    }));
  }
}

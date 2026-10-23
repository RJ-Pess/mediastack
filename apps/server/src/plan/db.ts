import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { defaultDesired, withDefaults, type Desired } from './desired.js';

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
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS flags (name TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS connections (
        service TEXT PRIMARY KEY, url TEXT NOT NULL, username TEXT, secret TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS secrets (name TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, actor TEXT NOT NULL,
        field_id TEXT NOT NULL, service TEXT NOT NULL, before TEXT, after TEXT,
        status TEXT NOT NULL, error TEXT
      );
    `);
  }

  userCount(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
  }

  createUser(username: string, passwordHash: string): number {
    const r = this.db
      .prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
      .run(username, passwordHash);
    return Number(r.lastInsertRowid);
  }

  findUser(username: string): { id: number; passwordHash: string } | undefined {
    const r = this.db
      .prepare('SELECT id, password_hash FROM users WHERE username = ?')
      .get(username) as { id: number; password_hash: string } | undefined;
    return r && { id: r.id, passwordHash: r.password_hash };
  }

  createSession(tokenHash: string, userId: number, expiresAt: number): void {
    this.db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
    this.db
      .prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
      .run(tokenHash, userId, expiresAt);
  }

  sessionUser(tokenHash: string): { userId: number; username: string } | undefined {
    const r = this.db
      .prepare(
        `SELECT u.id AS userId, u.username FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.expires_at > ?`,
      )
      .get(tokenHash, Date.now()) as { userId: number; username: string } | undefined;
    return r;
  }

  deleteSession(tokenHash: string): void {
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
  }

  /** Segredos de terceiros (já cifrados pelo chamador). */
  putSecret(name: string, ciphertext: string): void {
    this.db
      .prepare(
        'INSERT INTO secrets (name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value',
      )
      .run(name, ciphertext);
  }

  putConnection(service: string, url: string, username: string | null, secretCipher: string): void {
    this.db
      .prepare(
        `INSERT INTO connections (service, url, username, secret) VALUES (?, ?, ?, ?)
         ON CONFLICT(service) DO UPDATE SET url = excluded.url, username = excluded.username, secret = excluded.secret`,
      )
      .run(service, url, username, secretCipher);
  }

  listConnections(): { service: string; url: string; username: string | null; secret: string }[] {
    return this.db.prepare('SELECT service, url, username, secret FROM connections').all() as never;
  }

  clearConnections(): void {
    this.db.prepare('DELETE FROM connections').run();
  }

  listSecrets(): Record<string, string> {
    const rows = this.db.prepare('SELECT name, value FROM secrets').all() as {
      name: string;
      value: string;
    }[];
    return Object.fromEntries(rows.map((r) => [r.name, r.value]));
  }

  getSecret(name: string): string | undefined {
    return (
      this.db.prepare('SELECT value FROM secrets WHERE name = ?').get(name) as
        { value: string } | undefined
    )?.value;
  }

  getFlag(name: string): boolean {
    return this.db.prepare('SELECT 1 FROM flags WHERE name = ?').get(name) !== undefined;
  }

  setFlag(name: string): void {
    this.db.prepare('INSERT OR IGNORE INTO flags (name, value) VALUES (?, ?)').run(name, '1');
  }

  hasDesired(): boolean {
    return this.db.prepare('SELECT 1 FROM desired WHERE id = 1').get() !== undefined;
  }

  getDesired(): Desired {
    const row = this.db.prepare('SELECT json FROM desired WHERE id = 1').get() as
      { json: string } | undefined;
    return row ? withDefaults(JSON.parse(row.json)) : defaultDesired();
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

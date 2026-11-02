import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import type { D1DatabaseLike, D1PreparedStatement, D1Result } from './types';

function normalizeParam(val: unknown): SQLInputValue {
  if (val === undefined || val === null) return null;
  if (typeof val === 'boolean') return val ? 1 : 0;
  if (typeof val === 'number' || typeof val === 'string' || typeof val === 'bigint') {
    return val;
  }
  if (val instanceof Uint8Array) return val;
  return JSON.stringify(val);
}

class LocalD1PreparedStatement implements D1PreparedStatement {
  private db: DatabaseSync;
  private query: string;
  private params: SQLInputValue[];

  constructor(db: DatabaseSync, query: string, params: SQLInputValue[] = []) {
    this.db = db;
    this.query = query;
    this.params = params;
  }

  bind(...values: unknown[]): D1PreparedStatement {
    return new LocalD1PreparedStatement(
      this.db,
      this.query,
      values.map(normalizeParam)
    );
  }

  async first<T = Record<string, unknown>>(colName?: string): Promise<T | null> {
    const stmt = this.db.prepare(this.query);
    const row = stmt.get(...this.params) as Record<string, unknown> | undefined;
    if (!row) return null;
    if (colName) return (row[colName] as T) ?? null;
    return row as T;
  }

  async run(): Promise<{ success: boolean; meta?: Record<string, unknown> }> {
    const stmt = this.db.prepare(this.query);
    const info = stmt.run(...this.params);
    return {
      success: true,
      meta: {
        changes: Number(info.changes),
        last_row_id: Number(info.lastInsertRowid),
      },
    };
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const stmt = this.db.prepare(this.query);
    const rows = stmt.all(...this.params) as T[];
    return {
      results: rows,
      success: true,
    };
  }
}

export class LocalD1Database implements D1DatabaseLike {
  private db: DatabaseSync;

  constructor(dbFilePath: string, schemaFilePath: string) {
    const dir = path.dirname(dbFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new DatabaseSync(dbFilePath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');

    if (fs.existsSync(schemaFilePath)) {
      const schemaSql = fs.readFileSync(schemaFilePath, 'utf-8');
      this.db.exec(schemaSql);
      // 기준 스키마에는 이미 예전에 추가한 것들이 들어 있다. 로컬 DB를 열 때마다
      // 과거의 데이터 정리 마이그레이션을 다시 돌리지 않는다.
      const syncMigration = path.join(path.dirname(schemaFilePath), '0002_reader_sync.sql');
      if (fs.existsSync(syncMigration)) this.db.exec(fs.readFileSync(syncMigration, 'utf-8'));
      const xMigration = path.join(path.dirname(schemaFilePath), '0005_x_connection_settings.sql');
      if (fs.existsSync(xMigration)) this.db.exec(fs.readFileSync(xMigration, 'utf-8'));
    }
  }

  prepare(query: string): D1PreparedStatement {
    return new LocalD1PreparedStatement(this.db, query);
  }

  async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    const out: D1Result<T>[] = [];
    for (const s of statements) {
      out.push(await s.all<T>());
    }
    return out;
  }

  async exec(query: string): Promise<{ count: number; duration: number }> {
    const start = Date.now();
    this.db.exec(query);
    return { count: 1, duration: Date.now() - start };
  }
}

export function loadDevVars(rootDir: string): Record<string, string> {
  const vars: Record<string, string> = {};
  const devVarsPath = path.join(rootDir, '.dev.vars');
  if (fs.existsSync(devVarsPath)) {
    const lines = fs.readFileSync(devVarsPath, 'utf-8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed
          .slice(eqIdx + 1)
          .trim()
          .replace(/^["']|["']$/g, '');
        vars[key] = val;
      }
    }
  }
  return vars;
}

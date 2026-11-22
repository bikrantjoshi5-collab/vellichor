import { DatabaseSync } from 'node:sqlite';
import type { SqlExecutor, SqlParam } from '@/db/types';

export function createTestSqliteExecutor(): SqlExecutor & { close: () => void } {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON;');

  return {
    async execAsync(sql: string): Promise<void> {
      raw.exec(sql);
    },
    async runAsync(sql: string, params: SqlParam[] = []): Promise<{ changes: number; lastInsertRowId: number }> {
      const stmt = raw.prepare(sql);
      const res = stmt.run(...params);
      return {
        changes: Number(res.changes ?? 0),
        lastInsertRowId: Number(res.lastInsertRowid ?? 0),
      };
    },
    async getFirstAsync<T>(sql: string, params: SqlParam[] = []): Promise<T | null> {
      const stmt = raw.prepare(sql);
      const row = stmt.get(...params) as T | undefined;
      return row ?? null;
    },
    async getAllAsync<T>(sql: string, params: SqlParam[] = []): Promise<T[]> {
      const stmt = raw.prepare(sql);
      return stmt.all(...params) as T[];
    },
    close() {
      raw.close();
    },
  };
}

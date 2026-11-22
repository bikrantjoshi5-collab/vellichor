import { SCHEMA_SQL } from './schema';
import type { SqlExecutor, SqlParam } from './types';

let appDbPromise: Promise<SqlExecutor> | null = null;

async function ensureColumn(db: SqlExecutor, table: string, column: string, definition: string): Promise<void> {
  const cols = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
  if (!cols.some((c) => c.name === column)) {
    await db.execAsync(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export async function initDatabase(db: SqlExecutor): Promise<void> {
  await db.execAsync(SCHEMA_SQL);
  // Safe additive migrations for existing on-device databases
  await ensureColumn(db, 'shelves', 'color_token', "TEXT NOT NULL DEFAULT 'terracotta'");
  await ensureColumn(db, 'plugins', 'installed_manifest_hash', 'TEXT');
  await ensureColumn(db, 'plugins', 'installed_etag', 'TEXT');
  await ensureColumn(db, 'plugins', 'remote_etag', 'TEXT');
  await ensureColumn(db, 'tracker_links', 'pending_chapter', 'REAL');
}

export async function getSetting(db: SqlExecutor, key: string): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM app_settings WHERE key = ?', [key]);
  return row?.value ?? null;
}

export async function setSetting(db: SqlExecutor, key: string, value: string): Promise<void> {
  await db.runAsync(
    'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value]
  );
}

export async function getAllSettings(db: SqlExecutor): Promise<Record<string, string>> {
  const rows = await db.getAllAsync<{ key: string; value: string }>('SELECT key, value FROM app_settings');
  const out: Record<string, string> = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

export function openAppDatabase(): Promise<SqlExecutor> {
  if (!appDbPromise) {
    appDbPromise = (async () => {
      // Dynamic require keeps pure-Node Jest tests decoupled from Expo native runtime.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const SQLite = require('expo-sqlite');
      const raw = await SQLite.openDatabaseAsync('vellichor.db');
      const executor: SqlExecutor = {
        execAsync: (sql: string) => raw.execAsync(sql),
        runAsync: async (sql: string, params: SqlParam[] = []) => {
          const res = await raw.runAsync(sql, params);
          return {
            changes: Number(res.changes ?? 0),
            lastInsertRowId: Number(res.lastInsertRowId ?? 0),
          };
        },
        getFirstAsync: <T>(sql: string, params: SqlParam[] = []) => raw.getFirstAsync(sql, params) as Promise<T | null>,
        getAllAsync: <T>(sql: string, params: SqlParam[] = []) => raw.getAllAsync(sql, params) as Promise<T[]>,
      };
      await initDatabase(executor);
      return executor;
    })();
  }
  return appDbPromise;
}

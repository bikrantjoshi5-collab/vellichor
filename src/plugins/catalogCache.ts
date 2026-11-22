import type { SqlExecutor } from '@/db/types';
import type { PluginFilters, PluginNovelItem } from './types';

export interface CatalogCacheEntry {
  cacheKey: string;
  pluginId: string;
  items: PluginNovelItem[];
  lastPage: number;
  hasMore: boolean;
  updatedAt: number;
}

export const DEFAULT_CATALOG_CACHE_TTL_MS = 15 * 60 * 1000;

function serializeFilterValues(filters: PluginFilters): string {
  const keys = Object.keys(filters).sort();
  if (keys.length === 0) return '';
  const compact: Record<string, unknown> = {};
  for (const k of keys) {
    compact[k] = filters[k]?.value ?? null;
  }
  return JSON.stringify(compact);
}

export function buildCatalogCacheKey(params: {
  pluginId: string;
  mode: 'popular' | 'latest' | 'filter' | 'search';
  query?: string;
  filters?: PluginFilters;
}): string {
  const q = (params.query ?? '').trim().toLowerCase();
  if (params.mode === 'search' || q.length > 0) {
    return `${params.pluginId}::search::${q}`;
  }
  if (params.mode === 'filter' && params.filters) {
    return `${params.pluginId}::filter::${serializeFilterValues(params.filters)}`;
  }
  return `${params.pluginId}::${params.mode}`;
}

export function mergeUniqueNovels(
  existing: PluginNovelItem[],
  incoming: PluginNovelItem[]
): { merged: PluginNovelItem[]; addedCount: number } {
  const seen = new Set(existing.map((n) => n.path));
  const merged = [...existing];
  let addedCount = 0;
  for (const item of incoming) {
    if (!item?.path || seen.has(item.path)) continue;
    seen.add(item.path);
    merged.push(item);
    addedCount++;
  }
  return { merged, addedCount };
}

export function isCacheStale(updatedAt: number, ttlMs = DEFAULT_CATALOG_CACHE_TTL_MS, now = Date.now()): boolean {
  return now - updatedAt > ttlMs;
}

export async function readCatalogCache(
  db: SqlExecutor,
  cacheKey: string
): Promise<CatalogCacheEntry | null> {
  const row = await db.getFirstAsync<{
    cache_key: string;
    plugin_id: string;
    items_json: string;
    last_page: number;
    has_more: number;
    updated_at: number;
  }>('SELECT * FROM source_catalog_cache WHERE cache_key = ?', [cacheKey]);

  if (!row) return null;
  try {
    const items = JSON.parse(row.items_json) as PluginNovelItem[];
    if (!Array.isArray(items)) return null;
    return {
      cacheKey: row.cache_key,
      pluginId: row.plugin_id,
      items,
      lastPage: Math.max(1, row.last_page),
      hasMore: row.has_more === 1,
      updatedAt: row.updated_at,
    };
  } catch {
    return null;
  }
}

export async function writeCatalogCache(
  db: SqlExecutor,
  entry: Omit<CatalogCacheEntry, 'updatedAt'> & { updatedAt?: number }
): Promise<void> {
  const now = entry.updatedAt ?? Date.now();
  await db.runAsync(
    `INSERT INTO source_catalog_cache (cache_key, plugin_id, items_json, last_page, has_more, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(cache_key) DO UPDATE SET
       items_json = excluded.items_json,
       last_page = excluded.last_page,
       has_more = excluded.has_more,
       updated_at = excluded.updated_at`,
    [
      entry.cacheKey,
      entry.pluginId,
      JSON.stringify(entry.items),
      Math.max(1, entry.lastPage),
      entry.hasMore ? 1 : 0,
      now,
    ]
  );
}

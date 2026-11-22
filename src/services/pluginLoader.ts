import type { SqlExecutor } from '@/db/types';
import { pluginRepo } from '@/db/repositories/pluginRepo';
import { loadPluginFromCode } from '@/plugins/runtime';
import type { PluginInstance, PluginKeyValueStorage } from '@/plugins/types';
import { createExpoPluginBundleStore } from '@/downloads/storage';

const loadedCache = new Map<string, { hash: string | null; instance: PluginInstance }>();
const bundleStore = createExpoPluginBundleStore();

export function invalidateLoadedPlugin(pluginId: string): void {
  loadedCache.delete(pluginId);
}

interface StoredEnvelope {
  v: unknown;
  exp?: number;
}

export async function getRuntimePlugin(db: SqlExecutor, pluginId: string): Promise<PluginInstance | null> {
  const row = await pluginRepo.getPluginById(db, pluginId);
  if (!row || !row.installed || !row.local_path) return null;

  const cached = loadedCache.get(pluginId);
  if (cached && cached.hash === row.bundle_hash) {
    return cached.instance;
  }

  const code = await bundleStore.readBundle(row.local_path);
  const initialKv = await pluginRepo.getPluginStorageMap(db, pluginId);
  const mem = new Map<string, string>(Object.entries(initialKv));

  // Full LNReader-compatible @libs/storage preserving JSON objects/arrays and optional expiry.
  const storage: PluginKeyValueStorage & {
    getAllKeys: () => string[];
    clearAll: () => void;
  } = {
    get(key: string) {
      const raw = mem.get(key);
      if (raw === undefined) return null;
      try {
        const parsed = JSON.parse(raw) as StoredEnvelope;
        if (parsed && typeof parsed === 'object' && 'v' in parsed) {
          if (parsed.exp && Date.now() > parsed.exp) {
            mem.delete(key);
            void pluginRepo.deletePluginStorage(db, pluginId, key);
            return null;
          }
          return parsed.v as string;
        }
        return parsed as string;
      } catch {
        return raw;
      }
    },
    set(key: string, value: unknown, expires?: Date | number) {
      const exp =
        expires instanceof Date ? expires.getTime() : typeof expires === 'number' ? expires : undefined;
      const serialized = JSON.stringify({ v: value, ...(exp ? { exp } : {}) });
      mem.set(key, serialized);
      void pluginRepo.setPluginStorage(db, pluginId, key, serialized);
    },
    delete(key: string) {
      mem.delete(key);
      void pluginRepo.deletePluginStorage(db, pluginId, key);
    },
    getAllKeys() {
      return Array.from(mem.keys());
    },
    clearAll() {
      mem.clear();
      void pluginRepo.clearPluginStorage(db, pluginId);
    },
  };

  const instance = loadPluginFromCode(code, {
    pluginId,
    storage,
  });

  loadedCache.set(pluginId, { hash: row.bundle_hash, instance });
  return instance;
}

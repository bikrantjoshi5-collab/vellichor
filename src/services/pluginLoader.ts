import type { SqlExecutor } from '@/db/types';
import { pluginRepo } from '@/db/repositories/pluginRepo';
import { loadPluginFromCode } from '@/plugins/runtime';
import type { PluginInstance } from '@/plugins/types';
import { createExpoPluginBundleStore } from '@/downloads/storage';

const loadedCache = new Map<string, { hash: string | null; instance: PluginInstance }>();
const bundleStore = createExpoPluginBundleStore();

export function invalidateLoadedPlugin(pluginId: string): void {
  loadedCache.delete(pluginId);
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

  const instance = loadPluginFromCode(code, {
    pluginId,
    storage: {
      get: (k) => mem.get(k) ?? null,
      set: (k, v) => {
        mem.set(k, String(v));
        void pluginRepo.setPluginStorage(db, pluginId, k, String(v));
      },
      delete: (k) => {
        mem.delete(k);
        void pluginRepo.deletePluginStorage(db, pluginId, k);
      },
    },
  });

  loadedCache.set(pluginId, { hash: row.bundle_hash, instance });
  return instance;
}

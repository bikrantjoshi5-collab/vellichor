import type { PluginRow, RepoRow, SqlExecutor } from '../types';

export interface ManifestPluginUpsert {
  id: string;
  name: string;
  lang: string;
  site: string;
  version: string;
  iconUrl: string | null;
  fileUrl: string;
  remoteHash?: string | null;
}

export const pluginRepo = {
  async addRepo(db: SqlExecutor, url: string, name?: string): Promise<number> {
    const cleanUrl = url.trim();
    const existing = await db.getFirstAsync<RepoRow>('SELECT * FROM repos WHERE url = ?', [cleanUrl]);
    if (existing) return existing.id;
    const derivedName = name?.trim() || cleanUrl.split('/').slice(-4, -2).join('/') || 'GitHub Repo';
    const res = await db.runAsync('INSERT INTO repos (url, name) VALUES (?, ?)', [cleanUrl, derivedName]);
    return res.lastInsertRowId;
  },

  async listRepos(db: SqlExecutor): Promise<RepoRow[]> {
    return db.getAllAsync<RepoRow>('SELECT * FROM repos ORDER BY id ASC');
  },

  async deleteRepo(db: SqlExecutor, repoId: number): Promise<void> {
    await db.runAsync('DELETE FROM repos WHERE id = ?', [repoId]);
  },

  async updateRepoCheck(db: SqlExecutor, repoId: number, etag: string | null, checkedAt = Date.now()): Promise<void> {
    await db.runAsync('UPDATE repos SET etag = ?, last_checked_at = ? WHERE id = ?', [etag, checkedAt, repoId]);
  },

  async upsertPluginFromManifest(db: SqlExecutor, repoId: number, p: ManifestPluginUpsert): Promise<void> {
    const now = Date.now();
    const existing = await db.getFirstAsync<PluginRow>('SELECT * FROM plugins WHERE id = ?', [p.id]);
    if (existing) {
      await db.runAsync(
        `UPDATE plugins SET
          repo_id = ?,
          name = ?,
          lang = ?,
          site = ?,
          remote_version = ?,
          remote_hash = COALESCE(?, remote_hash),
          icon_url = COALESCE(?, icon_url),
          file_url = ?,
          updated_at = ?
        WHERE id = ?`,
        [repoId, p.name, p.lang, p.site, p.version, p.remoteHash ?? null, p.iconUrl, p.fileUrl, now, p.id]
      );
      return;
    }

    await db.runAsync(
      `INSERT INTO plugins (
        id, repo_id, name, lang, site, version, remote_version,
        bundle_hash, remote_hash, icon_url, file_url, installed, enabled, updated_at
      ) VALUES (?, ?, ?, ?, ?, '0.0.0', ?, NULL, ?, ?, ?, 0, 1, ?)`,
      [p.id, repoId, p.name, p.lang, p.site, p.version, p.remoteHash ?? null, p.iconUrl, p.fileUrl, now]
    );
  },

  async markPluginInstalled(
    db: SqlExecutor,
    pluginId: string,
    info: { version: string; bundleHash: string; localPath: string }
  ): Promise<void> {
    await db.runAsync(
      `UPDATE plugins SET
        version = ?,
        bundle_hash = ?,
        remote_hash = COALESCE(remote_hash, ?),
        local_path = ?,
        installed = 1,
        updated_at = ?
      WHERE id = ?`,
      [info.version, info.bundleHash, info.bundleHash, info.localPath, Date.now(), pluginId]
    );
  },

  async markPluginUninstalled(db: SqlExecutor, pluginId: string): Promise<void> {
    await db.runAsync(
      `UPDATE plugins SET installed = 0, local_path = NULL, bundle_hash = NULL, version = '0.0.0', updated_at = ? WHERE id = ?`,
      [Date.now(), pluginId]
    );
  },

  async getPluginById(db: SqlExecutor, pluginId: string): Promise<PluginRow | null> {
    return db.getFirstAsync<PluginRow>('SELECT * FROM plugins WHERE id = ?', [pluginId]);
  },

  async listPlugins(db: SqlExecutor, installedOnly = false): Promise<PluginRow[]> {
    const where = installedOnly ? 'WHERE installed = 1' : '';
    return db.getAllAsync<PluginRow>(`SELECT * FROM plugins ${where} ORDER BY installed DESC, name ASC`);
  },

  async getPluginStorageMap(db: SqlExecutor, pluginId: string): Promise<Record<string, string>> {
    const rows = await db.getAllAsync<{ key: string; value: string }>(
      'SELECT key, value FROM plugin_storage WHERE plugin_id = ?',
      [pluginId]
    );
    const map: Record<string, string> = {};
    for (const r of rows) map[r.key] = r.value;
    return map;
  },

  async setPluginStorage(db: SqlExecutor, pluginId: string, key: string, value: string): Promise<void> {
    await db.runAsync(
      `INSERT INTO plugin_storage (plugin_id, key, value) VALUES (?, ?, ?)
       ON CONFLICT(plugin_id, key) DO UPDATE SET value = excluded.value`,
      [pluginId, key, value]
    );
  },

  async deletePluginStorage(db: SqlExecutor, pluginId: string, key: string): Promise<void> {
    await db.runAsync('DELETE FROM plugin_storage WHERE plugin_id = ? AND key = ?', [pluginId, key]);
  },
};

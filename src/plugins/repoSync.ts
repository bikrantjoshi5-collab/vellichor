import type { SqlExecutor } from '@/db/types';
import { pluginRepo } from '@/db/repositories/pluginRepo';
import { hashBundleCode } from './semver';
import type { FetchLike, NormalizedManifestPlugin, RawManifestPlugin } from './types';

function defaultFetch(): FetchLike {
  return (url, init) => fetch(url, init) as unknown as ReturnType<FetchLike>;
}

/**
 * Resolves a relative path from an LNReader plugins.min.json manifest against the repo root.
 * Example repoUrl:
 *   https://raw.githubusercontent.com/user/repo/plugins/v3.0.0/.dist/plugins.min.json
 * Root base becomes:
 *   https://raw.githubusercontent.com/user/repo/plugins/v3.0.0/
 */
export function resolveRepoAssetUrl(repoUrl: string, assetPath?: string | null): string | null {
  if (!assetPath) return null;
  if (/^https?:\/\//i.test(assetPath)) return assetPath;

  const withoutQuery = repoUrl.split('?')[0];
  let base = withoutQuery.replace(/\/[^/]+$/, '/');
  if (base.endsWith('/.dist/')) {
    base = base.slice(0, -'.dist/'.length);
  }
  const cleanAsset = assetPath.replace(/^\/+/, '');
  return `${base}${cleanAsset}`;
}

export function appendCacheBuster(url: string, nowMs: number): string {
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}t=${nowMs}`;
}

export interface FetchManifestOptions {
  fetchImpl?: FetchLike;
  nowMs?: number;
}

export interface FetchManifestResult {
  etag: string | null;
  plugins: NormalizedManifestPlugin[];
}

export async function fetchRepoManifest(
  repoUrl: string,
  opts: FetchManifestOptions = {}
): Promise<FetchManifestResult> {
  const fetchImpl = opts.fetchImpl ?? defaultFetch();
  const nowMs = opts.nowMs ?? Date.now();
  const bustedUrl = appendCacheBuster(repoUrl.trim(), nowMs);

  const res = await fetchImpl(bustedUrl, {
    method: 'GET',
    headers: {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Pragma: 'no-cache',
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch repo manifest (HTTP ${res.status})`);
  }

  const rawText = await res.text();
  const parsed = JSON.parse(rawText) as RawManifestPlugin[] | { plugins?: RawManifestPlugin[] };
  const rawList = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.plugins) ? parsed.plugins : [];

  const plugins: NormalizedManifestPlugin[] = [];
  for (const item of rawList) {
    if (!item?.id || !item?.name) continue;
    const fileUrl = resolveRepoAssetUrl(repoUrl, item.url ?? item.file);
    if (!fileUrl) continue;
    const iconUrl = resolveRepoAssetUrl(repoUrl, item.iconUrl ?? item.icon ?? null);
    plugins.push({
      id: String(item.id),
      name: String(item.name),
      version: String(item.version ?? '1.0.0'),
      lang: String(item.lang ?? 'English'),
      site: String(item.site ?? ''),
      iconUrl,
      fileUrl,
      remoteHash: item.hash ? String(item.hash) : null,
    });
  }

  const etag = res.headers?.get('etag') ?? null;
  return { etag, plugins };
}

export async function syncAllRepos(
  db: SqlExecutor,
  opts: { fetchImpl?: FetchLike; nowMs?: number } = {}
): Promise<{ reposChecked: number; pluginsIndexed: number; errors: string[] }> {
  const repos = await pluginRepo.listRepos(db);
  let pluginsIndexed = 0;
  const errors: string[] = [];

  for (const repo of repos) {
    try {
      const manifest = await fetchRepoManifest(repo.url, opts);
      await pluginRepo.updateRepoCheck(db, repo.id, manifest.etag, opts.nowMs ?? Date.now());
      for (const p of manifest.plugins) {
        await pluginRepo.upsertPluginFromManifest(db, repo.id, p);
        pluginsIndexed++;
      }
    } catch (err) {
      errors.push(`${repo.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { reposChecked: repos.length, pluginsIndexed, errors };
}

export interface PluginBundleStore {
  writeBundle(pluginId: string, code: string): Promise<string>;
  readBundle(localPath: string): Promise<string>;
  deleteBundle(localPath: string): Promise<void>;
}

export async function installOrUpdatePlugin(
  db: SqlExecutor,
  pluginId: string,
  bundleStore: PluginBundleStore,
  opts: { fetchImpl?: FetchLike; nowMs?: number } = {}
): Promise<{ version: string; bundleHash: string; localPath: string }> {
  const row = await pluginRepo.getPluginById(db, pluginId);
  if (!row) throw new Error(`Plugin "${pluginId}" not found in any repo`);

  const fetchImpl = opts.fetchImpl ?? defaultFetch();
  const bustedUrl = appendCacheBuster(row.file_url, opts.nowMs ?? Date.now());
  const res = await fetchImpl(bustedUrl, {
    method: 'GET',
    headers: {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Pragma: 'no-cache',
    },
  });
  if (!res.ok) {
    throw new Error(`Failed to download plugin bundle (HTTP ${res.status})`);
  }
  const code = await res.text();
  const bundleHash = hashBundleCode(code);
  const localPath = await bundleStore.writeBundle(pluginId, code);

  await pluginRepo.markPluginInstalled(db, pluginId, {
    version: row.remote_version || row.version || '1.0.0',
    bundleHash,
    localPath,
  });

  return {
    version: row.remote_version || row.version || '1.0.0',
    bundleHash,
    localPath,
  };
}

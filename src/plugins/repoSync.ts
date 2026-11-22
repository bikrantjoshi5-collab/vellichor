import type { SqlExecutor } from '@/db/types';
import { pluginRepo } from '@/db/repositories/pluginRepo';
import { hashBundleCode } from './semver';
import {
  assertSafeExternalUrl,
  assertSafePluginId,
  auditPluginCode,
  verifyBundleIntegrity,
} from './security';
import type { FetchLike, NormalizedManifestPlugin, RawManifestPlugin } from './types';

function defaultFetch(): FetchLike {
  return (url, init) => fetch(url, init) as unknown as ReturnType<FetchLike>;
}

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
    let safeId: string;
    try {
      safeId = assertSafePluginId(String(item.id));
    } catch {
      continue;
    }
    const fileUrl = resolveRepoAssetUrl(repoUrl, item.url ?? item.file);
    if (!fileUrl) continue;
    try {
      assertSafeExternalUrl(fileUrl, `plugin "${safeId}" bundle URL`);
    } catch {
      continue;
    }
    const rawIconUrl = resolveRepoAssetUrl(repoUrl, item.iconUrl ?? item.icon ?? null);
    let iconUrl: string | null = null;
    if (rawIconUrl) {
      try {
        iconUrl = assertSafeExternalUrl(rawIconUrl, `plugin "${safeId}" icon URL`);
      } catch {
        iconUrl = null;
      }
    }
    plugins.push({
      id: safeId,
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

async function probeRemoteBundleEtag(
  fileUrl: string,
  fetchImpl: FetchLike,
  nowMs: number
): Promise<string | null> {
  try {
    const res = await fetchImpl(appendCacheBuster(fileUrl, nowMs), {
      method: 'HEAD',
      headers: { 'Cache-Control': 'no-cache' },
    });
    if (!res.ok) return null;
    return res.headers?.get('etag') ?? res.headers?.get('last-modified') ?? null;
  } catch {
    return null;
  }
}

export async function syncAllRepos(
  db: SqlExecutor,
  opts: { fetchImpl?: FetchLike; nowMs?: number } = {}
): Promise<{ reposChecked: number; pluginsIndexed: number; errors: string[] }> {
  const fetchImpl = opts.fetchImpl ?? defaultFetch();
  const nowMs = opts.nowMs ?? Date.now();
  const repos = await pluginRepo.listRepos(db);
  let pluginsIndexed = 0;
  const errors: string[] = [];

  for (const repo of repos) {
    try {
      const manifest = await fetchRepoManifest(repo.url, { fetchImpl, nowMs });
      await pluginRepo.updateRepoCheck(db, repo.id, manifest.etag, nowMs);
      for (const p of manifest.plugins) {
        await pluginRepo.upsertPluginFromManifest(db, repo.id, p);
        pluginsIndexed++;
      }
    } catch (err) {
      errors.push(`${repo.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Probe HTTP ETag on installed plugins whose manifest lacks a hash field so silent same-version GitHub commits are caught.
  const installed = await pluginRepo.listPlugins(db, true);
  for (const p of installed) {
    if (!p.remote_hash && p.file_url) {
      const remoteEtag = await probeRemoteBundleEtag(p.file_url, fetchImpl, nowMs);
      if (remoteEtag) {
        await pluginRepo.updateRemoteEtag(db, p.id, remoteEtag);
      }
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
  const safeId = assertSafePluginId(pluginId);
  const row = await pluginRepo.getPluginById(db, safeId);
  if (!row) throw new Error(`Plugin "${safeId}" not found in any repo`);

  const fetchImpl = opts.fetchImpl ?? defaultFetch();
  const safeFileUrl = assertSafeExternalUrl(row.file_url, `plugin "${safeId}" download`);
  const bustedUrl = appendCacheBuster(safeFileUrl, opts.nowMs ?? Date.now());
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
  // Verify manifest hash integrity AND static security audit BEFORE writing to disk or activating.
  await verifyBundleIntegrity(code, row.remote_hash, safeId);
  auditPluginCode(code, safeId);
  const bundleHash = hashBundleCode(code);
  const etag = res.headers?.get('etag') ?? res.headers?.get('last-modified') ?? row.remote_etag ?? null;
  const localPath = await bundleStore.writeBundle(safeId, code);

  await pluginRepo.markPluginInstalled(db, pluginId, {
    version: row.remote_version || row.version || '1.0.0',
    bundleHash,
    manifestHash: row.remote_hash ?? null,
    etag,
    localPath,
  });

  return {
    version: row.remote_version || row.version || '1.0.0',
    bundleHash,
    localPath,
  };
}

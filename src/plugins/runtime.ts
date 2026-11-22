import { createPluginShims } from './shims';
import { cloneFilters } from './filters';
import { assertSafePluginId, auditPluginCode } from './security';
import type {
  FetchLike,
  PluginChapterItem,
  PluginFilters,
  PluginInstance,
  PluginKeyValueStorage,
  PluginNovelItem,
  PluginSourceNovel,
} from './types';

export interface LoadPluginContext {
  pluginId: string;
  fetchImpl?: FetchLike;
  storage?: PluginKeyValueStorage;
  timeoutMs?: number;
}

function createEphemeralStorage(): PluginKeyValueStorage {
  const map = new Map<string, string>();
  return {
    get: (k) => map.get(k) ?? null,
    set: (k, v) => {
      map.set(k, String(v));
    },
    delete: (k) => {
      map.delete(k);
    },
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  if (ms <= 0) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

export function loadPluginFromCode(code: string, context: LoadPluginContext): PluginInstance {
  const safeId = assertSafePluginId(context.pluginId);
  auditPluginCode(code, safeId);

  const shims = createPluginShims({
    fetchImpl: context.fetchImpl,
    storage: context.storage ?? createEphemeralStorage(),
  });

  const sandboxRequire = (moduleName: string) => {
    if (Object.prototype.hasOwnProperty.call(shims, moduleName)) {
      return shims[moduleName];
    }
    throw new Error(`Unsupported module "${moduleName}" requested by plugin "${safeId}"`);
  };

  const fetchShim = (shims['@libs/fetch'] as { fetchApi: FetchLike }).fetchApi;
  const safeGlobal = Object.freeze({});
  const moduleObj: { exports: Record<string, unknown> } = { exports: {} };

  // Hardened strict scope: shadows native bridges, raw globals, Metro internals, and raw fetch.
  const runner = new Function(
    'require',
    'exports',
    'module',
    'fetch',
    'globalThis',
    'global',
    'window',
    'self',
    'XMLHttpRequest',
    'WebSocket',
    'expo',
    'NativeModules',
    '__turboModuleProxy',
    'nativeModuleProxy',
    '__r',
    '__d',
    'process',
    'Function',
    `'use strict';\n${code}`
  );

  runner(
    sandboxRequire,
    moduleObj.exports,
    moduleObj,
    fetchShim,
    safeGlobal,
    safeGlobal,
    safeGlobal,
    safeGlobal,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined
  );

  const exported = (moduleObj.exports?.default ?? moduleObj.exports) as Record<string, unknown>;
  if (!exported || typeof exported !== 'object') {
    throw new Error(`Plugin "${safeId}" did not export a valid plugin instance`);
  }

  const timeoutMs = context.timeoutMs ?? 25_000;
  const site = String(exported.site ?? '');

  const normalizeNovelItem = (raw: Record<string, unknown>): PluginNovelItem => ({
    name: String(raw.name ?? 'Untitled'),
    path: String(raw.path ?? raw.url ?? ''),
    cover: raw.cover ? String(raw.cover) : undefined,
  });

  const normalizeChapterItem = (raw: Record<string, unknown>, idx: number): PluginChapterItem => ({
    name: String(raw.name ?? `Chapter ${idx + 1}`),
    path: String(raw.path ?? raw.url ?? ''),
    chapterNumber: typeof raw.chapterNumber === 'number' ? raw.chapterNumber : idx + 1,
    releaseTime: raw.releaseTime ? String(raw.releaseTime) : null,
  });

  const rawFilters =
    exported.filters && typeof exported.filters === 'object'
      ? cloneFilters(exported.filters as PluginFilters)
      : undefined;

  return {
    id: String(exported.id ?? safeId),
    name: String(exported.name ?? safeId),
    site,
    version: String(exported.version ?? '1.0.0'),
    icon: exported.icon ? String(exported.icon) : undefined,
    filters: rawFilters,

    async popularNovels(
      pageNo: number,
      options?: { filters?: PluginFilters; showLatestNovels?: boolean; [k: string]: unknown }
    ): Promise<PluginNovelItem[]> {
      if (typeof exported.popularNovels !== 'function') return [];
      const mergedOptions = {
        showLatestNovels: false,
        ...(options ?? {}),
        filters: options?.filters ?? cloneFilters(rawFilters),
      };
      const res = await withTimeout(
        Promise.resolve((exported.popularNovels as Function).call(exported, pageNo, mergedOptions)),
        timeoutMs,
        `${safeId}.popularNovels`
      );
      return Array.isArray(res) ? res.map((x) => normalizeNovelItem(x as Record<string, unknown>)) : [];
    },

    async searchNovels(searchTerm: string, pageNo: number): Promise<PluginNovelItem[]> {
      if (typeof exported.searchNovels !== 'function') return [];
      const res = await withTimeout(
        Promise.resolve((exported.searchNovels as Function).call(exported, searchTerm, pageNo)),
        timeoutMs,
        `${safeId}.searchNovels`
      );
      return Array.isArray(res) ? res.map((x) => normalizeNovelItem(x as Record<string, unknown>)) : [];
    },

    async parseNovel(novelPath: string): Promise<PluginSourceNovel> {
      const fn = (exported.parseNovel ?? exported.parseNovelAndChapters) as Function | undefined;
      if (typeof fn !== 'function') {
        throw new Error(`Plugin "${safeId}" does not implement parseNovel`);
      }
      const raw = (await withTimeout(
        Promise.resolve(fn.call(exported, novelPath)),
        timeoutMs,
        `${safeId}.parseNovel`
      )) as Record<string, unknown>;
      const rawChapters = Array.isArray(raw.chapters) ? raw.chapters : [];
      return {
        path: String(raw.path ?? novelPath),
        name: String(raw.name ?? 'Untitled'),
        cover: raw.cover ? String(raw.cover) : undefined,
        author: raw.author ? String(raw.author) : undefined,
        summary: raw.summary ? String(raw.summary) : undefined,
        status: raw.status ? String(raw.status) : undefined,
        genres: raw.genres ? String(raw.genres) : undefined,
        chapters: rawChapters.map((ch, idx) => normalizeChapterItem(ch as Record<string, unknown>, idx)),
      };
    },

    async parseChapter(chapterPath: string): Promise<string> {
      if (typeof exported.parseChapter !== 'function') {
        throw new Error(`Plugin "${safeId}" does not implement parseChapter`);
      }
      const html = await withTimeout(
        Promise.resolve((exported.parseChapter as Function).call(exported, chapterPath)),
        timeoutMs,
        `${safeId}.parseChapter`
      );
      return String(html ?? '');
    },

    resolveUrl(path: string, isNovel?: boolean): string {
      if (typeof exported.resolveUrl === 'function') {
        return String((exported.resolveUrl as Function).call(exported, path, isNovel));
      }
      if (/^https?:\/\//i.test(path)) return path;
      return `${site.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
    },
  };
}

export interface PluginNovelItem {
  name: string;
  path: string;
  cover?: string;
}

export interface PluginChapterItem {
  name: string;
  path: string;
  chapterNumber?: number;
  releaseTime?: string | null;
}

export interface PluginSourceNovel {
  path: string;
  name: string;
  cover?: string;
  author?: string;
  summary?: string;
  status?: string;
  genres?: string;
  chapters: PluginChapterItem[];
}

export interface PluginInstance {
  id: string;
  name: string;
  site: string;
  version: string;
  icon?: string;
  popularNovels(pageNo: number, options?: Record<string, unknown>): Promise<PluginNovelItem[]>;
  searchNovels(searchTerm: string, pageNo: number): Promise<PluginNovelItem[]>;
  parseNovel(novelPath: string): Promise<PluginSourceNovel>;
  parseChapter(chapterPath: string): Promise<string>;
  resolveUrl?(path: string, isNovel?: boolean): string;
}

export interface FetchResponseLike {
  ok: boolean;
  status: number;
  headers?: { get(name: string): string | null };
  text(): Promise<string>;
  json?(): Promise<unknown>;
}

export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string }
) => Promise<FetchResponseLike>;

export interface PluginKeyValueStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
  delete(key: string): void;
}

export interface RawManifestPlugin {
  id: string;
  name: string;
  version: string;
  lang?: string;
  site?: string;
  icon?: string;
  iconUrl?: string;
  url?: string;
  file?: string;
  hash?: string;
}

export interface NormalizedManifestPlugin {
  id: string;
  name: string;
  version: string;
  lang: string;
  site: string;
  iconUrl: string | null;
  fileUrl: string;
  remoteHash: string | null;
}

export class PluginHttpError extends Error {
  status: number;
  isCloudflare: boolean;

  constructor(message: string, status: number, isCloudflare = false) {
    super(message);
    this.name = 'PluginHttpError';
    this.status = status;
    this.isCloudflare = isCloudflare;
  }
}

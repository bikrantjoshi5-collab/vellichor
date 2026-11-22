export type SqlParam = string | number | null;

export interface SqlRunResult {
  changes: number;
  lastInsertRowId: number;
}

export interface SqlExecutor {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params?: SqlParam[]): Promise<SqlRunResult>;
  getFirstAsync<T>(sql: string, params?: SqlParam[]): Promise<T | null>;
  getAllAsync<T>(sql: string, params?: SqlParam[]): Promise<T[]>;
}

export type ReadingStatus = 'reading' | 'plan_to_read' | 'on_hold' | 'completed' | 'dropped';
export type DownloadJobStatus = 'pending' | 'running' | 'completed' | 'rate_limited' | 'failed' | 'paused' | 'cf_required';
export type TrackerProvider = 'anilist' | 'mal' | 'novelupdates';

export interface RepoRow {
  id: number;
  url: string;
  name: string;
  etag: string | null;
  last_checked_at: number | null;
}

export interface PluginRow {
  id: string;
  repo_id: number | null;
  name: string;
  lang: string;
  site: string;
  version: string;
  remote_version: string;
  bundle_hash: string | null;
  remote_hash: string | null;
  icon_url: string | null;
  file_url: string;
  local_path: string | null;
  installed: number;
  enabled: number;
  updated_at: number;
}

export interface NovelRow {
  id: number;
  plugin_id: string;
  path: string;
  title: string;
  author: string | null;
  cover_url: string | null;
  local_cover_path: string | null;
  summary: string | null;
  source_status: string | null;
  reading_status: ReadingStatus;
  in_library: number;
  last_read_at: number | null;
  created_at: number;
}

export interface NovelWithStats extends NovelRow {
  total_chapters: number;
  read_chapters: number;
  unread_chapters: number;
  downloaded_chapters: number;
  last_chapter_name: string | null;
  last_chapter_id: number | null;
}

export interface ShelfRow {
  id: number;
  name: string;
  sort_order: number;
  created_at: number;
}

export interface ChapterRow {
  id: number;
  novel_id: number;
  path: string;
  name: string;
  chapter_number: number;
  release_date: string | null;
  discovered_at: number;
  is_read: number;
  read_progress_pct: number;
  scroll_paragraph_idx: number;
  is_downloaded: number;
  content_path: string | null;
  assets_dir: string | null;
  updated_at: number;
}

export interface ChapterUpdateRow extends ChapterRow {
  novel_title: string;
  novel_cover_url: string | null;
  novel_plugin_id: string;
}

export interface DownloadJobRow {
  id: number;
  chapter_id: number;
  novel_id: number;
  plugin_id: string;
  status: DownloadJobStatus;
  attempt_count: number;
  next_retry_at: number | null;
  last_error: string | null;
  created_at: number;
}

export interface TrackerLinkRow {
  id: number;
  novel_id: number;
  provider: TrackerProvider;
  remote_id: string;
  remote_title: string;
  remote_url: string | null;
  status: ReadingStatus;
  last_chapter_synced: number;
  volume_progress: number;
  chapter_offset: number;
  score: number;
  pending_sync: number;
  updated_at: number;
}

export interface ReadingHistoryRow {
  id: number;
  novel_id: number;
  chapter_id: number;
  read_at: number;
  duration_sec: number;
  novel_title?: string;
  novel_cover_url?: string | null;
  chapter_name?: string;
}

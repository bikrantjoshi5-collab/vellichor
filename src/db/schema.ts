export const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS repos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  etag TEXT,
  last_checked_at INTEGER
);

CREATE TABLE IF NOT EXISTS plugins (
  id TEXT PRIMARY KEY,
  repo_id INTEGER REFERENCES repos(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  lang TEXT NOT NULL DEFAULT 'English',
  site TEXT NOT NULL DEFAULT '',
  version TEXT NOT NULL DEFAULT '0.0.0',
  remote_version TEXT NOT NULL DEFAULT '0.0.0',
  bundle_hash TEXT,
  installed_manifest_hash TEXT,
  remote_hash TEXT,
  installed_etag TEXT,
  remote_etag TEXT,
  icon_url TEXT,
  file_url TEXT NOT NULL,
  local_path TEXT,
  installed INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS novels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plugin_id TEXT NOT NULL,
  path TEXT NOT NULL,
  title TEXT NOT NULL,
  author TEXT,
  cover_url TEXT,
  local_cover_path TEXT,
  summary TEXT,
  source_status TEXT,
  reading_status TEXT NOT NULL DEFAULT 'reading',
  in_library INTEGER NOT NULL DEFAULT 0,
  last_read_at INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE(plugin_id, path)
);

CREATE TABLE IF NOT EXISTS shelves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  color_token TEXT NOT NULL DEFAULT 'terracotta',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS novel_shelves (
  novel_id INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  shelf_id INTEGER NOT NULL REFERENCES shelves(id) ON DELETE CASCADE,
  PRIMARY KEY (novel_id, shelf_id)
);

CREATE TABLE IF NOT EXISTS chapters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  novel_id INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  name TEXT NOT NULL,
  chapter_number REAL NOT NULL DEFAULT 0,
  release_date TEXT,
  discovered_at INTEGER NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0,
  read_progress_pct REAL NOT NULL DEFAULT 0,
  scroll_paragraph_idx INTEGER NOT NULL DEFAULT 0,
  scroll_offset_y REAL NOT NULL DEFAULT 0,
  is_downloaded INTEGER NOT NULL DEFAULT 0,
  content_path TEXT,
  assets_dir TEXT,
  updated_at INTEGER NOT NULL,
  UNIQUE(novel_id, path)
);

CREATE INDEX IF NOT EXISTS idx_chapters_novel ON chapters(novel_id, chapter_number);
CREATE INDEX IF NOT EXISTS idx_chapters_discovered ON chapters(discovered_at DESC);

CREATE TABLE IF NOT EXISTS download_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chapter_id INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  novel_id INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  plugin_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_retry_at INTEGER,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(chapter_id)
);

CREATE INDEX IF NOT EXISTS idx_download_jobs_status ON download_jobs(status, next_retry_at);

CREATE TABLE IF NOT EXISTS tracker_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  novel_id INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  remote_id TEXT NOT NULL,
  remote_title TEXT NOT NULL,
  remote_url TEXT,
  status TEXT NOT NULL DEFAULT 'reading',
  last_chapter_synced REAL NOT NULL DEFAULT 0,
  volume_progress INTEGER NOT NULL DEFAULT 0,
  chapter_offset INTEGER NOT NULL DEFAULT 0,
  score REAL NOT NULL DEFAULT 0,
  pending_sync INTEGER NOT NULL DEFAULT 0,
  pending_chapter REAL,
  updated_at INTEGER NOT NULL,
  UNIQUE(novel_id, provider)
);

CREATE TABLE IF NOT EXISTS reading_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  novel_id INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  chapter_id INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  read_at INTEGER NOT NULL,
  duration_sec INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_history_read_at ON reading_history(read_at DESC);

CREATE TABLE IF NOT EXISTS plugin_storage (
  plugin_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (plugin_id, key)
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS source_catalog_cache (
  cache_key TEXT PRIMARY KEY,
  plugin_id TEXT NOT NULL,
  items_json TEXT NOT NULL,
  last_page INTEGER NOT NULL DEFAULT 1,
  has_more INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_catalog_cache_plugin ON source_catalog_cache(plugin_id, updated_at DESC);
`;

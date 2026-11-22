import type {
  ChapterRow,
  NovelRow,
  ReadingStatus,
  RepoRow,
  ShelfRow,
  SqlExecutor,
  TrackerLinkRow,
  TrackerProvider,
} from '@/db/types';
import { getAllSettings, setSetting } from '@/db/database';
import { libraryRepo } from '@/db/repositories/libraryRepo';
import { chapterRepo } from '@/db/repositories/chapterRepo';
import { pluginRepo } from '@/db/repositories/pluginRepo';
import { trackerRepo } from '@/db/repositories/trackerRepo';

export const MOSS_BACKUP_VERSION = 1;

export interface MossBackupPayload {
  schemaVersion: number;
  app: 'Vellichor';
  exportedAt: string;
  repos: Array<{ url: string; name: string }>;
  shelves: Array<{ name: string; colorToken?: string; sortOrder: number }>;
  novels: Array<{
    pluginId: string;
    path: string;
    title: string;
    author: string | null;
    coverUrl: string | null;
    summary: string | null;
    sourceStatus: string | null;
    readingStatus: ReadingStatus;
    inLibrary: boolean;
    lastReadAt: number | null;
    shelfNames: string[];
    chapters: Array<{
      path: string;
      name: string;
      chapterNumber: number;
      releaseDate: string | null;
      discoveredAt: number;
      isRead: boolean;
      readProgressPct: number;
      scrollParagraphIdx: number;
      scrollOffsetY?: number;
    }>;
    trackers: Array<{
      provider: TrackerProvider;
      remoteId: string;
      remoteTitle: string;
      remoteUrl: string | null;
      status: ReadingStatus;
      lastChapterSynced: number;
      volumeProgress: number;
      chapterOffset: number;
      score: number;
    }>;
  }>;
  settings: Record<string, string>;
}

export async function exportMossBackup(db: SqlExecutor): Promise<string> {
  const repos = await db.getAllAsync<RepoRow>('SELECT * FROM repos ORDER BY id ASC');
  const shelves = await db.getAllAsync<ShelfRow>('SELECT * FROM shelves ORDER BY sort_order ASC');
  const novels = await db.getAllAsync<NovelRow>('SELECT * FROM novels WHERE in_library = 1 ORDER BY id ASC');
  const settings = await getAllSettings(db);

  const novelEntries: MossBackupPayload['novels'] = [];
  for (const n of novels) {
    const novelShelves = await libraryRepo.getShelvesForNovel(db, n.id);
    const chapters = await db.getAllAsync<ChapterRow>('SELECT * FROM chapters WHERE novel_id = ? ORDER BY chapter_number ASC', [n.id]);
    const trackers = await db.getAllAsync<TrackerLinkRow>('SELECT * FROM tracker_links WHERE novel_id = ?', [n.id]);

    novelEntries.push({
      pluginId: n.plugin_id,
      path: n.path,
      title: n.title,
      author: n.author,
      coverUrl: n.cover_url,
      summary: n.summary,
      sourceStatus: n.source_status,
      readingStatus: n.reading_status,
      inLibrary: n.in_library === 1,
      lastReadAt: n.last_read_at,
      shelfNames: novelShelves.map((s) => s.name),
      chapters: chapters.map((c) => ({
        path: c.path,
        name: c.name,
        chapterNumber: c.chapter_number,
        releaseDate: c.release_date,
        discoveredAt: c.discovered_at,
        isRead: c.is_read === 1,
        readProgressPct: c.read_progress_pct,
        scrollParagraphIdx: c.scroll_paragraph_idx,
        scrollOffsetY: c.scroll_offset_y ?? 0,
      })),
      trackers: trackers.map((t) => ({
        provider: t.provider,
        remoteId: t.remote_id,
        remoteTitle: t.remote_title,
        remoteUrl: t.remote_url,
        status: t.status,
        lastChapterSynced: t.last_chapter_synced,
        volumeProgress: t.volume_progress,
        chapterOffset: t.chapter_offset,
        score: t.score,
      })),
    });
  }

  const payload: MossBackupPayload = {
    schemaVersion: MOSS_BACKUP_VERSION,
    app: 'Vellichor',
    exportedAt: new Date().toISOString(),
    repos: repos.map((r) => ({ url: r.url, name: r.name })),
    shelves: shelves.map((s) => ({
      name: s.name,
      colorToken: s.color_token || 'terracotta',
      sortOrder: s.sort_order,
    })),
    novels: novelEntries,
    settings,
  };

  return JSON.stringify(payload, null, 2);
}

export async function importMossBackup(
  db: SqlExecutor,
  rawJson: string
): Promise<{ reposImported: number; shelvesImported: number; novelsImported: number; chaptersImported: number }> {
  const payload = JSON.parse(rawJson) as MossBackupPayload;
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.novels)) {
    throw new Error('Invalid Vellichor backup file');
  }

  let reposImported = 0;
  for (const r of payload.repos ?? []) {
    if (!r?.url) continue;
    await pluginRepo.addRepo(db, r.url, r.name);
    reposImported++;
  }

  const shelfMap = new Map<string, number>();
  let shelvesImported = 0;
  for (const s of payload.shelves ?? []) {
    if (!s?.name) continue;
    const row = await libraryRepo.createShelf(db, s.name, s.colorToken || 'terracotta');
    shelfMap.set(row.name, row.id);
    shelvesImported++;
  }

  let novelsImported = 0;
  let chaptersImported = 0;
  for (const n of payload.novels) {
    const novelId = await libraryRepo.upsertNovel(db, {
      pluginId: n.pluginId,
      path: n.path,
      title: n.title,
      author: n.author,
      coverUrl: n.coverUrl,
      summary: n.summary,
      sourceStatus: n.sourceStatus,
      readingStatus: n.readingStatus ?? 'reading',
      inLibrary: n.inLibrary ?? true,
      lastReadAt: n.lastReadAt,
    });
    novelsImported++;

    for (const shelfName of n.shelfNames ?? []) {
      let sid = shelfMap.get(shelfName);
      if (!sid) {
        const created = await libraryRepo.createShelf(db, shelfName);
        sid = created.id;
        shelfMap.set(shelfName, sid);
      }
      await libraryRepo.assignNovelToShelf(db, novelId, sid);
    }

    if (Array.isArray(n.chapters) && n.chapters.length > 0) {
      await chapterRepo.upsertChapters(
        db,
        novelId,
        n.chapters.map((c) => ({
          path: c.path,
          name: c.name,
          chapterNumber: c.chapterNumber,
          releaseDate: c.releaseDate,
          discoveredAt: c.discoveredAt,
          isRead: c.isRead,
          readProgressPct: c.readProgressPct,
          scrollParagraphIdx: c.scrollParagraphIdx,
        }))
      );
      chaptersImported += n.chapters.length;
    }

    for (const t of n.trackers ?? []) {
      await trackerRepo.upsertLink(db, {
        novelId,
        provider: t.provider,
        remoteId: t.remoteId,
        remoteTitle: t.remoteTitle,
        remoteUrl: t.remoteUrl,
        status: t.status,
        lastChapterSynced: t.lastChapterSynced,
        volumeProgress: t.volumeProgress,
        chapterOffset: t.chapterOffset,
        score: t.score,
      });
    }
  }

  for (const [k, v] of Object.entries(payload.settings ?? {})) {
    await setSetting(db, k, String(v));
  }

  return { reposImported, shelvesImported, novelsImported, chaptersImported };
}

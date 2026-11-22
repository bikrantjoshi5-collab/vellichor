import {
  buildCatalogCacheKey,
  isCacheStale,
  mergeUniqueNovels,
  readCatalogCache,
  writeCatalogCache,
} from '@/plugins/catalogCache';
import { computeRestoreScrollY, findNearestParagraphIndex } from '@/reader/restorePosition';
import { createTestSqliteExecutor } from './helpers/sqliteTestDb';
import { initDatabase } from '@/db/database';
import { libraryRepo } from '@/db/repositories/libraryRepo';
import { chapterRepo } from '@/db/repositories/chapterRepo';
import { historyRepo } from '@/db/repositories/historyRepo';

describe('Continuous source catalog cache & exact mid-chapter resume', () => {
  test('caches paginated source catalog in SQLite and deduplicates continuous scroll pages', async () => {
    const db = createTestSqliteExecutor();
    try {
      await initDatabase(db);

      const keyPop = buildCatalogCacheKey({ pluginId: 'novelfire', mode: 'popular' });
      const keyLatest = buildCatalogCacheKey({ pluginId: 'novelfire', mode: 'latest' });
      expect(keyPop).not.toBe(keyLatest);

      const page1 = [
        { name: 'Lord of the Mysteries', path: '/lotm' },
        { name: 'Shadow Slave', path: '/ss' },
      ];
      const page2 = [
        { name: 'Shadow Slave', path: '/ss' }, // duplicate across pages
        { name: 'Omniscient Reader', path: '/orv' },
      ];

      const { merged, addedCount } = mergeUniqueNovels(page1, page2);
      expect(addedCount).toBe(1);
      expect(merged.map((n) => n.path)).toEqual(['/lotm', '/ss', '/orv']);

      await writeCatalogCache(db, {
        cacheKey: keyPop,
        pluginId: 'novelfire',
        items: merged,
        lastPage: 2,
        hasMore: true,
        updatedAt: 5000,
      });

      const cached = await readCatalogCache(db, keyPop);
      expect(cached).not.toBeNull();
      expect(cached?.lastPage).toBe(2);
      expect(cached?.items).toHaveLength(3);
      expect(isCacheStale(5000, 15 * 60 * 1000, 6000)).toBe(false);
      expect(isCacheStale(5000, 15 * 60 * 1000, 5000 + 20 * 60 * 1000)).toBe(true);
    } finally {
      db.close();
    }
  });

  test('computes pixel-exact and paragraph-exact scroll restore even across font-size changes', () => {
    // 1. Pixel-exact restore when layout matches saved percentage
    const exactY = computeRestoreScrollY({
      savedOffsetY: 1480,
      savedPct: 37,
      savedParagraphIdx: 12,
      blockYMap: { 12: 1420 },
      contentHeight: 4600,
      viewportHeight: 600,
    });
    expect(exactY).toBe(1480);

    // 2. Font size increased dramatically (contentHeight doubled) -> uses exact paragraph Y!
    const paragraphY = computeRestoreScrollY({
      savedOffsetY: 1480,
      savedPct: 37,
      savedParagraphIdx: 12,
      blockYMap: { 12: 2840 },
      contentHeight: 8600,
      viewportHeight: 600,
    });
    expect(paragraphY).toBe(2840);

    // 3. Fallback to proportional percentage when paragraph layout isn't measured yet
    const pctY = computeRestoreScrollY({
      savedOffsetY: 0,
      savedPct: 50,
      savedParagraphIdx: 0,
      blockYMap: {},
      contentHeight: 4600,
      viewportHeight: 600,
    });
    expect(pctY).toBe(2000);

    expect(findNearestParagraphIndex({ 0: 0, 1: 120, 2: 260, 3: 410 }, 275)).toBe(2);
  });

  test('persists exact mid-chapter percentage, paragraph, and scroll_offset_y and exposes it for Continue Reading', async () => {
    const db = createTestSqliteExecutor();
    try {
      await initDatabase(db);
      const novelId = await libraryRepo.upsertNovel(db, {
        pluginId: 'novelfire',
        path: '/lotm',
        title: 'Lord of the Mysteries',
        inLibrary: true,
      });
      await chapterRepo.upsertChapters(db, novelId, [
        { path: '/c1', name: 'Chapter 1', chapterNumber: 1 },
        { path: '/c2', name: 'Chapter 2', chapterNumber: 2 },
      ]);
      const chapters = await chapterRepo.listByNovel(db, novelId, 'asc');
      const ch1 = chapters[0];

      await historyRepo.recordSession(db, { novelId, chapterId: ch1.id });
      await chapterRepo.saveReadProgress(db, ch1.id, {
        isRead: false,
        readProgressPct: 63,
        scrollParagraphIdx: 19,
        scrollOffsetY: 2520,
      });

      const reloaded = await chapterRepo.getChapterById(db, ch1.id);
      expect(reloaded?.read_progress_pct).toBe(63);
      expect(reloaded?.scroll_paragraph_idx).toBe(19);
      expect(reloaded?.scroll_offset_y).toBe(2520);

      // Even if user scrolls back up slightly to 41%, exact position is preserved (not stuck at 63%)
      await chapterRepo.saveReadProgress(db, ch1.id, {
        isRead: false,
        readProgressPct: 41,
        scrollParagraphIdx: 12,
        scrollOffsetY: 1640,
      });
      const reloadedBack = await chapterRepo.getChapterById(db, ch1.id);
      expect(reloadedBack?.read_progress_pct).toBe(41);
      expect(reloadedBack?.scroll_offset_y).toBe(1640);

      const lib = await libraryRepo.listLibraryNovels(db);
      expect(lib[0]?.last_chapter_id).toBe(ch1.id);
      expect(lib[0]?.last_chapter_progress_pct).toBe(41);
    } finally {
      db.close();
    }
  });
});

import JSZip from 'jszip';
import { createTestSqliteExecutor } from './helpers/sqliteTestDb';
import { initDatabase } from '@/db/database';
import { libraryRepo } from '@/db/repositories/libraryRepo';
import { chapterRepo } from '@/db/repositories/chapterRepo';
import { pluginRepo } from '@/db/repositories/pluginRepo';
import { trackerRepo } from '@/db/repositories/trackerRepo';
import {
  applyChapterOffset,
  flushPendingTrackerSyncs,
  pullRemoteProgressToLocal,
  resolveSyncAction,
  syncTrackerProgress,
} from '@/trackers/syncService';
import { exportMossBackup, importMossBackup } from '@/backup/mossBackup';
import { previewLnReaderZip, importLnReaderZip } from '@/backup/lnreaderImport';

describe('Tracker sync, Moss JSON backup/restore, and LNReader .zip migration', () => {
  test('detects conflict when remote chapter exceeds local and applies chapter offset accurately (Review Focus #4)', async () => {
    expect(applyChapterOffset(120, -20)).toBe(100);
    expect(applyChapterOffset(5, -10)).toBe(0);

    expect(resolveSyncAction(50, 80, 0)).toEqual({
      action: 'conflict',
      localEffective: 50,
      remoteChapter: 80,
    });
    expect(resolveSyncAction(85, 80, 0)).toEqual({
      action: 'push',
      localEffective: 85,
      remoteChapter: 80,
    });
    expect(resolveSyncAction(100, 80, -20)).toEqual({
      action: 'noop',
      localEffective: 80,
      remoteChapter: 80,
    });

    const db = createTestSqliteExecutor();
    try {
      await initDatabase(db);
      const novelId = await libraryRepo.upsertNovel(db, {
        pluginId: 'novelbin',
        path: '/lotm',
        title: 'Lord of the Mysteries',
        inLibrary: true,
      });
      await trackerRepo.upsertLink(db, {
        novelId,
        provider: 'anilist',
        remoteId: '105398',
        remoteTitle: 'Lord of the Mysteries',
        status: 'reading',
        lastChapterSynced: 100,
        volumeProgress: 3,
        chapterOffset: 0,
      });

      // Simulate offline push failure -> queues pending_sync = 1
      const offlineResult = await syncTrackerProgress(db, {
        novelId,
        provider: 'anilist',
        localChapter: 105,
        pushRemote: async () => {
          throw new Error('Network offline');
        },
      });
      expect(offlineResult.outcome).toBe('queued_offline');
      const link = await trackerRepo.getLink(db, novelId, 'anilist');
      expect(link?.pending_sync).toBe(1);
    } finally {
      db.close();
    }
  });

  test('round-trips full Midnight Moss JSON backup preserving shelves, reading_status, scroll index, trackers, and repos', async () => {
    const db1 = createTestSqliteExecutor();
    const db2 = createTestSqliteExecutor();
    try {
      await initDatabase(db1);
      await initDatabase(db2);

      await pluginRepo.addRepo(db1, 'https://raw.githubusercontent.com/u/r/plugins/.dist/plugins.min.json', 'Community');
      const novelId = await libraryRepo.upsertNovel(db1, {
        pluginId: 'novelbin',
        path: '/lotm',
        title: 'Lord of the Mysteries',
        readingStatus: 'reading',
        inLibrary: true,
      });
      const shelf = await libraryRepo.createShelf(db1, 'Top Picks');
      await libraryRepo.assignNovelToShelf(db1, novelId, shelf.id);
      await chapterRepo.upsertChapters(db1, novelId, [
        { path: '/c/1', name: 'Ch 1', chapterNumber: 1, discoveredAt: 1000 },
      ]);
      const [ch] = await chapterRepo.listByNovel(db1, novelId);
      await chapterRepo.saveReadProgress(db1, ch.id, {
        isRead: true,
        readProgressPct: 100,
        scrollParagraphIdx: 42,
      });
      await trackerRepo.upsertLink(db1, {
        novelId,
        provider: 'mal',
        remoteId: '999',
        remoteTitle: 'LOTM',
        status: 'reading',
        lastChapterSynced: 1,
      });

      const backupJson = await exportMossBackup(db1);
      const summary = await importMossBackup(db2, backupJson);

      expect(summary.novelsImported).toBe(1);
      expect(summary.reposImported).toBe(1);

      const restoredNovels = await libraryRepo.listLibraryNovels(db2);
      expect(restoredNovels).toHaveLength(1);
      expect(restoredNovels[0].reading_status).toBe('reading');

      const restoredShelves = await libraryRepo.getShelvesForNovel(db2, restoredNovels[0].id);
      expect(restoredShelves.map((s) => s.name)).toEqual(['Top Picks']);

      const restoredChapters = await chapterRepo.listByNovel(db2, restoredNovels[0].id);
      expect(restoredChapters[0].scroll_paragraph_idx).toBe(42);
      expect(restoredChapters[0].is_read).toBe(1);
    } finally {
      db1.close();
      db2.close();
    }
  });

  test('imports partial LNReader .zip backups without Category.json and deduplicates novels gracefully (Review Focus #5)', async () => {
    const zip = new JSZip();
    zip.file(
      'Novel.json',
      JSON.stringify([
        { id: 1, pluginId: 'novelbin', path: '/ss', name: 'Shadow Slave', author: 'Guiltythree', inLibrary: 1 },
        { id: 2, pluginId: 'novelbin', path: '/ss', name: 'Shadow Slave', author: 'Guiltythree', inLibrary: 1 },
      ])
    );
    zip.file(
      'Chapter.json',
      JSON.stringify([
        { id: 10, novelId: 1, path: '/ss/ch1', name: 'Ch 1', chapterNumber: 1, unread: 0, progress: 100 },
        { id: 11, novelId: 1, path: '/ss/ch2', name: 'Ch 2', chapterNumber: 2, unread: 1, progress: 35 },
      ])
    );
    const bytes = await zip.generateAsync({ type: 'uint8array' });

    const preview = await previewLnReaderZip(bytes);
    expect(preview.novelsCount).toBe(1);
    expect(preview.chaptersCount).toBe(2);
    expect(preview.categoriesCount).toBe(0);

    const db = createTestSqliteExecutor();
    try {
      await initDatabase(db);
      const imported = await importLnReaderZip(db, bytes);
      expect(imported.novelsImported).toBe(1);
      expect(imported.chaptersImported).toBe(2);

      const novels = await libraryRepo.listLibraryNovels(db);
      expect(novels).toHaveLength(1);
      const chs = await chapterRepo.listByNovel(db, novels[0].id);
      expect(chs.find((c) => c.chapter_number === 1)?.is_read).toBe(1);
      expect(chs.find((c) => c.chapter_number === 2)?.is_read).toBe(0);
    } finally {
      db.close();
    }
  });

  test('imports modern LNReader v2 nested data.zip + NovelAndChapters/*.json and survives malformed JSON (Critical #4)', async () => {
    const inner = new JSZip();
    inner.file(
      'NovelAndChapters/42.json',
      JSON.stringify({
        id: 42,
        pluginId: 'novelbin',
        path: '/lotm',
        name: 'Lord of the Mysteries',
        author: 'Cuttlefish',
        inLibrary: true,
        chapters: [
          { path: '/lotm/1', name: 'Ch 1', chapterNumber: 1, unread: false },
          { path: '/lotm/2', name: 'Ch 2', chapterNumber: 2, unread: true },
        ],
      })
    );
    inner.file('Category.json', JSON.stringify({ malformed: true })); // non-array malformed JSON!
    const innerBytes = await inner.generateAsync({ type: 'uint8array' });

    const outer = new JSZip();
    outer.file('data.zip', innerBytes);
    const outerBytes = await outer.generateAsync({ type: 'uint8array' });

    const preview = await previewLnReaderZip(outerBytes);
    expect(preview.novelsCount).toBe(1);
    expect(preview.chaptersCount).toBe(2);

    const db = createTestSqliteExecutor();
    try {
      await initDatabase(db);
      const res = await importLnReaderZip(db, outerBytes);
      expect(res.novelsImported).toBe(1);
      expect(res.chaptersImported).toBe(2);
    } finally {
      db.close();
    }
  });

  test('persists pending chapter on offline tracker failure, flushes on reconnect, and supports Pull Remote Progress (Critical #5)', async () => {
    const db = createTestSqliteExecutor();
    try {
      await initDatabase(db);
      const novelId = await libraryRepo.upsertNovel(db, {
        pluginId: 'novelbin',
        path: '/orv',
        title: 'ORV',
        inLibrary: true,
      });
      await chapterRepo.upsertChapters(db, novelId, [
        { path: '/c/1', name: 'Ch 1', chapterNumber: 1, discoveredAt: 1 },
        { path: '/c/2', name: 'Ch 2', chapterNumber: 2, discoveredAt: 2 },
        { path: '/c/3', name: 'Ch 3', chapterNumber: 3, discoveredAt: 3 },
      ]);
      await trackerRepo.upsertLink(db, {
        novelId,
        provider: 'anilist',
        remoteId: '101',
        remoteTitle: 'ORV',
        status: 'reading',
        lastChapterSynced: 0,
      });

      // Pull remote progress = 2 marks chapters 1 and 2 as read locally
      await pullRemoteProgressToLocal(db, novelId, 'anilist', 2);
      const chs = await chapterRepo.listByNovel(db, novelId);
      expect(chs.filter((c) => c.is_read === 1).map((c) => c.chapter_number)).toEqual([1, 2]);

      // Offline push queues pending chapter 3, then flush pushes chapter 3 cleanly
      await syncTrackerProgress(db, {
        novelId,
        provider: 'anilist',
        localChapter: 3,
        pushRemote: async () => {
          throw new Error('offline');
        },
      });
      const pushed: number[] = [];
      const flushed = await flushPendingTrackerSyncs(db, async (_provider, update) => {
        pushed.push(update.chapter);
      });
      expect(flushed.synced).toBe(1);
      expect(pushed).toEqual([3]);
    } finally {
      db.close();
    }
  });
});

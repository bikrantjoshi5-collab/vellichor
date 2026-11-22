import { createTestSqliteExecutor } from './helpers/sqliteTestDb';
import { initDatabase } from '@/db/database';
import { libraryRepo } from '@/db/repositories/libraryRepo';
import { chapterRepo } from '@/db/repositories/chapterRepo';
import { downloadRepo } from '@/db/repositories/downloadRepo';
import { pluginRepo } from '@/db/repositories/pluginRepo';

describe('SQLite schema and core repositories', () => {
  test('initializes all tables and separates reading_status from many-to-many custom shelves', async () => {
    const db = createTestSqliteExecutor();
    try {
      await initDatabase(db);

      const novelId = await libraryRepo.upsertNovel(db, {
        pluginId: 'novelbin',
        path: '/novel/lotm',
        title: 'Lord of the Mysteries',
        author: 'Cuttlefish',
        coverUrl: 'https://example.com/lotm.jpg',
        summary: 'Victorian mysteries.',
        sourceStatus: 'Completed',
        readingStatus: 'reading',
        inLibrary: true,
      });

      const favShelf = await libraryRepo.createShelf(db, 'Favorites');
      const xianxiaShelf = await libraryRepo.createShelf(db, 'Dark Fantasy');
      await libraryRepo.assignNovelToShelf(db, novelId, favShelf.id);
      await libraryRepo.assignNovelToShelf(db, novelId, xianxiaShelf.id);

      await libraryRepo.setReadingStatus(db, novelId, 'completed');

      const novel = await libraryRepo.getNovelById(db, novelId);
      const shelves = await libraryRepo.getShelvesForNovel(db, novelId);

      expect(novel?.reading_status).toBe('completed');
      expect(shelves.map((s) => s.name).sort()).toEqual(['Dark Fantasy', 'Favorites']);

      const byShelf = await libraryRepo.listLibraryNovels(db, { shelfId: favShelf.id });
      expect(byShelf).toHaveLength(1);
      expect(byShelf[0].id).toBe(novelId);
    } finally {
      db.close();
    }
  });

  test('orders Updates feed by discovered_at and preserves exact scroll paragraph index', async () => {
    const db = createTestSqliteExecutor();
    try {
      await initDatabase(db);
      const novelId = await libraryRepo.upsertNovel(db, {
        pluginId: 'royalroad',
        path: '/fiction/mol',
        title: 'Mother of Learning',
        inLibrary: true,
      });

      await chapterRepo.upsertChapters(db, novelId, [
        { path: '/ch/1', name: 'Chapter 1', chapterNumber: 1, discoveredAt: 1000 },
        { path: '/ch/2', name: 'Chapter 2', chapterNumber: 2, discoveredAt: 3000 },
        { path: '/ch/3', name: 'Chapter 3', chapterNumber: 3, discoveredAt: 2000 },
      ]);

      const updates = await chapterRepo.listRecentUpdates(db, 10);
      expect(updates.map((u) => u.name)).toEqual(['Chapter 2', 'Chapter 3', 'Chapter 1']);

      const ch1 = updates.find((u) => u.name === 'Chapter 1')!;
      await chapterRepo.saveReadProgress(db, ch1.id, {
        isRead: false,
        readProgressPct: 64,
        scrollParagraphIdx: 17,
      });

      const reloaded = await chapterRepo.getChapterById(db, ch1.id);
      expect(reloaded?.scroll_paragraph_idx).toBe(17);
      expect(reloaded?.read_progress_pct).toBe(64);
    } finally {
      db.close();
    }
  });

  test('resets interrupted running download jobs to pending on startup recovery', async () => {
    const db = createTestSqliteExecutor();
    try {
      await initDatabase(db);
      const novelId = await libraryRepo.upsertNovel(db, {
        pluginId: 'novelbin',
        path: '/novel/ss',
        title: 'Shadow Slave',
        inLibrary: true,
      });
      await chapterRepo.upsertChapters(db, novelId, [
        { path: '/ch/1', name: 'Ch 1', chapterNumber: 1, discoveredAt: 1000 },
      ]);
      const chapters = await chapterRepo.listByNovel(db, novelId);
      const jobId = await downloadRepo.enqueueJob(db, {
        chapterId: chapters[0].id,
        novelId,
        pluginId: 'novelbin',
      });
      await downloadRepo.updateJobStatus(db, jobId, 'running');

      const recovered = await downloadRepo.resetInterruptedJobs(db);
      expect(recovered).toBe(1);

      const pending = await downloadRepo.listJobs(db, ['pending']);
      expect(pending).toHaveLength(1);
      expect(pending[0].id).toBe(jobId);
    } finally {
      db.close();
    }
  });

  test('stores repos and plugin metadata cleanly', async () => {
    const db = createTestSqliteExecutor();
    try {
      await initDatabase(db);
      const repoId = await pluginRepo.addRepo(db, 'https://raw.githubusercontent.com/user/repo/plugins/.dist/plugins.min.json', 'Main Repo');
      await pluginRepo.upsertPluginFromManifest(db, repoId, {
        id: 'novelbin',
        name: 'NovelBin',
        lang: 'English',
        site: 'https://novelbin.com',
        version: '2.5.0',
        iconUrl: 'https://raw.githubusercontent.com/user/repo/plugins/icon.png',
        fileUrl: 'https://raw.githubusercontent.com/user/repo/plugins/.dist/en/novelbin.js',
        remoteHash: 'abc123',
      });

      const list = await pluginRepo.listPlugins(db);
      expect(list).toHaveLength(1);
      expect(list[0].remote_version).toBe('2.5.0');
      expect(list[0].installed).toBe(0);
    } finally {
      db.close();
    }
  });
});

import { parseChapterHtml } from '@/reader/chapterParser';
import { DownloadEngine, type AssetFileStore } from '@/downloads/downloadEngine';
import { createTestSqliteExecutor } from './helpers/sqliteTestDb';
import { initDatabase } from '@/db/database';
import { libraryRepo } from '@/db/repositories/libraryRepo';
import { chapterRepo } from '@/db/repositories/chapterRepo';
import { downloadRepo } from '@/db/repositories/downloadRepo';
import type { PluginInstance } from '@/plugins/types';

function createMemoryAssetStore(): AssetFileStore & {
  files: Map<string, string>;
  deletedDirs: string[];
} {
  const files = new Map<string, string>();
  const deletedDirs: string[] = [];
  return {
    files,
    deletedDirs,
    async writeChapterContent(novelId, chapterId, json) {
      const p = `file:///chapters/${novelId}/${chapterId}/content.json`;
      files.set(p, json);
      return { contentPath: p, assetsDir: `file:///chapters/${novelId}/${chapterId}` };
    },
    async downloadIllustration(novelId, chapterId, index, url, _headers) {
      if (url.includes('broken.png')) {
        throw new Error('HTTP 404 image not found');
      }
      const p = `file:///chapters/${novelId}/${chapterId}/img_${index}.jpg`;
      files.set(p, `binary-of:${url}`);
      return p;
    },
    async deleteDirectory(dirPath) {
      deletedDirs.push(dirPath);
      for (const k of Array.from(files.keys())) {
        if (k.startsWith(dirPath)) files.delete(k);
      }
    },
  };
}

describe('Chapter parser and resilient bulk download engine', () => {
  test('parses chapter HTML into clean paragraph, heading, blockquote, divider, and image blocks', () => {
    const html = `
      <script>alert('ad')</script>
      <h2>Chapter 1: Crimson</h2>
      <p>The gas lamp flickered twice.</p>
      <blockquote>"Beware the fog."</blockquote>
      <hr />
      <p><img src="/illust/01.jpg" alt="Backlund Street" /></p>
      <p>Klein closed the ledger.</p>
    `;

    const blocks = parseChapterHtml(html, 'https://novelbin.example/book/1');
    expect(blocks).toEqual([
      { type: 'heading', text: 'Chapter 1: Crimson' },
      { type: 'paragraph', text: 'The gas lamp flickered twice.' },
      { type: 'blockquote', text: '"Beware the fog."' },
      { type: 'divider' },
      { type: 'image', uri: 'https://novelbin.example/illust/01.jpg', alt: 'Backlund Street' },
      { type: 'paragraph', text: 'Klein closed the ledger.' },
    ]);
  });

  test('preserves wrapped illustrations (<a>/<center>/<span>), lazy data-src, and <br> paragraph breaks (Important #8)', () => {
    const html = `
      <div><a href="/full"><img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" data-src="/art/plate1.jpg" alt="Plate 1" /></a></div>
      <center><img data-lazy-src="https://cdn.example/map.png" /></center>
      <p>First line.<br/>Second line.<br><br>Third line.</p>
    `;
    const blocks = parseChapterHtml(html, 'https://ln.example/vol1');
    expect(blocks).toEqual([
      { type: 'image', uri: 'https://ln.example/art/plate1.jpg', alt: 'Plate 1' },
      { type: 'image', uri: 'https://cdn.example/map.png' },
      { type: 'paragraph', text: 'First line.' },
      { type: 'paragraph', text: 'Second line.' },
      { type: 'paragraph', text: 'Third line.' },
    ]);
  });

  test('startLoop waits out short HTTP 429 backoff instead of exiting permanently and isolates source cooldown (Critical #2)', async () => {
    const db = createTestSqliteExecutor();
    const store = createMemoryAssetStore();
    try {
      await initDatabase(db);
      const n1 = await libraryRepo.upsertNovel(db, { pluginId: 'flaky', path: '/n1', title: 'Flaky', inLibrary: true });
      await chapterRepo.upsertChapters(db, n1, [
        { path: '/c1', name: 'C1', chapterNumber: 1, discoveredAt: 1 },
        { path: '/c2', name: 'C2', chapterNumber: 2, discoveredAt: 2 },
      ]);
      const [c1, c2] = await chapterRepo.listByNovel(db, n1);

      let calls = 0;
      const plugin: PluginInstance = {
        id: 'flaky', name: 'Flaky', site: 'https://flaky.example', version: '1.0.0',
        popularNovels: async () => [], searchNovels: async () => [],
        parseNovel: async () => ({ path: '/n1', name: 'Flaky', chapters: [] }),
        parseChapter: async () => {
          calls++;
          if (calls === 1) {
            const err: any = new Error('HTTP 429');
            err.status = 429;
            throw err;
          }
          return '<p>Done</p>';
        },
      };

      const engine = new DownloadEngine({
        db,
        assetStore: store,
        getPlugin: async () => plugin,
        politeDelayMs: 0,
        backoffScheduleMs: [25, 50, 100],
      });

      await engine.enqueueChapters(n1, 'flaky', [c1.id, c2.id]);
      await engine.startLoop();

      const jobs = await downloadRepo.listJobs(db);
      expect(jobs.every((j) => j.status === 'completed')).toBe(true);
      expect(calls).toBe(3); // 1 failed 429 + 2 succeeded after automatic wakeup!
    } finally {
      db.close();
    }
  });

  test('downloads text + offline illustrations and saves chapter cleanly even if one illustration fails (Review Focus #3)', async () => {
    const db = createTestSqliteExecutor();
    const store = createMemoryAssetStore();
    try {
      await initDatabase(db);
      const novelId = await libraryRepo.upsertNovel(db, {
        pluginId: 'jnovel',
        path: '/bookworm',
        title: 'Ascendance of a Bookworm',
        inLibrary: true,
      });
      await chapterRepo.upsertChapters(db, novelId, [
        { path: '/ch/1', name: 'Prologue', chapterNumber: 1, discoveredAt: 1000 },
      ]);
      const [ch] = await chapterRepo.listByNovel(db, novelId);

      const plugin: PluginInstance = {
        id: 'jnovel',
        name: 'JNovel',
        site: 'https://jnovel.example',
        version: '1.0.0',
        popularNovels: async () => [],
        searchNovels: async () => [],
        parseNovel: async () => ({ path: '/bookworm', name: 'Bookworm', chapters: [] }),
        parseChapter: async () =>
          `<p>Myne opened the book.</p><img src="https://cdn.example/good.jpg"/><img src="https://cdn.example/broken.png"/>`,
      };

      const engine = new DownloadEngine({
        db,
        assetStore: store,
        getPlugin: async () => plugin,
        politeDelayMs: 0,
      });

      await engine.enqueueChapters(novelId, 'jnovel', [ch.id]);
      const tick = await engine.processNextTick();

      expect(tick.completed).toBe(1);
      expect(tick.warnings).toHaveLength(1);
      const updated = await chapterRepo.getChapterById(db, ch.id);
      expect(updated?.is_downloaded).toBe(1);
      expect(updated?.content_path).toContain('content.json');

      const savedBlocks = JSON.parse(store.files.get(updated!.content_path!)!);
      const goodImg = savedBlocks.find((b: any) => b.type === 'image' && b.uri.startsWith('file:///'));
      expect(goodImg).toBeTruthy();

      await engine.deleteChapterAssets(ch.id);
      const afterDelete = await chapterRepo.getChapterById(db, ch.id);
      expect(afterDelete?.is_downloaded).toBe(0);
      expect(store.deletedDirs).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  test('isolates HTTP 429 backoff and Cloudflare 403 pauses per source so other sources still complete (Review Focus #2)', async () => {
    const db = createTestSqliteExecutor();
    const store = createMemoryAssetStore();
    try {
      await initDatabase(db);
      const n1 = await libraryRepo.upsertNovel(db, { pluginId: 'cf-site', path: '/n1', title: 'CF Novel', inLibrary: true });
      const n2 = await libraryRepo.upsertNovel(db, { pluginId: 'rate-site', path: '/n2', title: 'Rate Novel', inLibrary: true });
      const n3 = await libraryRepo.upsertNovel(db, { pluginId: 'ok-site', path: '/n3', title: 'Healthy Novel', inLibrary: true });

      await chapterRepo.upsertChapters(db, n1, [{ path: '/c1', name: 'C1', chapterNumber: 1, discoveredAt: 1 }]);
      await chapterRepo.upsertChapters(db, n2, [{ path: '/c2', name: 'C2', chapterNumber: 1, discoveredAt: 1 }]);
      await chapterRepo.upsertChapters(db, n3, [{ path: '/c3', name: 'C3', chapterNumber: 1, discoveredAt: 1 }]);

      const [c1] = await chapterRepo.listByNovel(db, n1);
      const [c2] = await chapterRepo.listByNovel(db, n2);
      const [c3] = await chapterRepo.listByNovel(db, n3);

      let rateAttempts = 0;
      const plugins: Record<string, PluginInstance> = {
        'cf-site': {
          id: 'cf-site', name: 'CF', site: 'https://cf.example', version: '1.0.0',
          popularNovels: async () => [], searchNovels: async () => [],
          parseNovel: async () => ({ path: '/n1', name: 'CF', chapters: [] }),
          parseChapter: async () => { const err: any = new Error('Cloudflare challenge'); err.status = 403; err.isCloudflare = true; throw err; },
        },
        'rate-site': {
          id: 'rate-site', name: 'Rate', site: 'https://rate.example', version: '1.0.0',
          popularNovels: async () => [], searchNovels: async () => [],
          parseNovel: async () => ({ path: '/n2', name: 'Rate', chapters: [] }),
          parseChapter: async () => {
            rateAttempts++;
            if (rateAttempts === 1) {
              const err: any = new Error('Too Many Requests');
              err.status = 429;
              throw err;
            }
            return '<p>Recovered after backoff.</p>';
          },
        },
        'ok-site': {
          id: 'ok-site', name: 'OK', site: 'https://ok.example', version: '1.0.0',
          popularNovels: async () => [], searchNovels: async () => [],
          parseNovel: async () => ({ path: '/n3', name: 'OK', chapters: [] }),
          parseChapter: async () => '<p>Downloaded cleanly.</p>',
        },
      };

      let now = 10_000;
      const engine = new DownloadEngine({
        db,
        assetStore: store,
        getPlugin: async (id) => plugins[id],
        politeDelayMs: 0,
        now: () => now,
        maxGlobalSources: 3,
      });

      await engine.enqueueChapters(n1, 'cf-site', [c1.id]);
      await engine.enqueueChapters(n2, 'rate-site', [c2.id]);
      await engine.enqueueChapters(n3, 'ok-site', [c3.id]);

      await engine.processNextTick();

      const jobsAfterFirst = await downloadRepo.listJobs(db);
      const cfJob = jobsAfterFirst.find((j) => j.plugin_id === 'cf-site')!;
      const rateJob = jobsAfterFirst.find((j) => j.plugin_id === 'rate-site')!;
      const okJob = jobsAfterFirst.find((j) => j.plugin_id === 'ok-site')!;

      expect(okJob.status).toBe('completed');
      expect(cfJob.status).toBe('cf_required');
      expect(rateJob.status).toBe('rate_limited');
      expect(rateJob.next_retry_at).toBe(13_000); // 3s initial backoff

      // Advance clock past 3s backoff — rate-site recovers while cf-site stays safely paused
      now = 15_000;
      await engine.processNextTick();

      const jobsAfterRetry = await downloadRepo.listJobs(db);
      expect(jobsAfterRetry.find((j) => j.plugin_id === 'rate-site')?.status).toBe('completed');
      expect(jobsAfterRetry.find((j) => j.plugin_id === 'cf-site')?.status).toBe('cf_required');
    } finally {
      db.close();
    }
  });
});

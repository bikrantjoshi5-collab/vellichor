import { TtsController, type SpeechDriver } from '@/reader/ttsController';
import { checkLibraryUpdates, WEEKLY_UPDATE_INTERVAL_SECONDS } from '@/updates/updateScheduler';
import { createTestSqliteExecutor } from './helpers/sqliteTestDb';
import { initDatabase } from '@/db/database';
import { libraryRepo } from '@/db/repositories/libraryRepo';
import { chapterRepo } from '@/db/repositories/chapterRepo';
import type { ChapterBlock } from '@/reader/chapterParser';
import type { PluginInstance } from '@/plugins/types';

describe('Non-intrusive docked TTS controller and weekly update scheduler', () => {
  test('starts OFF by default, speaks only text blocks, auto-advances chapter, and stops cleanly on disable', () => {
    const spoken: string[] = [];
    let stopCount = 0;
    let pendingOnDone: (() => void) | undefined;

    const driver: SpeechDriver = {
      speak(text, _opts, callbacks) {
        spoken.push(text);
        pendingOnDone = callbacks.onDone;
      },
      stop() {
        stopCount++;
        pendingOnDone = undefined;
      },
    };

    const blocks: ChapterBlock[] = [
      { type: 'heading', text: 'Chapter One' },
      { type: 'image', uri: 'file:///img_0.jpg' },
      { type: 'paragraph', text: 'Rain fell across Backlund.' },
      { type: 'divider' },
      { type: 'paragraph', text: 'The lamp stayed warm.' },
    ];

    let chapterFinished = false;
    const activeIndices: number[] = [];
    const tts = new TtsController(driver, {
      onActiveBlockChange: (idx) => activeIndices.push(idx),
      onChapterComplete: () => {
        chapterFinished = true;
      },
    });

    expect(tts.getState().enabled).toBe(false);
    expect(tts.getState().playing).toBe(false);

    // Calling play while disabled is a no-op
    tts.loadBlocks(blocks);
    tts.play();
    expect(spoken).toHaveLength(0);

    // Enable from Reader Settings and play
    tts.setEnabled(true);
    tts.play();
    expect(spoken).toEqual(['Chapter One']);
    expect(activeIndices[activeIndices.length - 1]).toBe(0);

    // Completing block 0 skips image (index 1) and speaks paragraph at index 2
    pendingOnDone?.();
    expect(spoken).toEqual(['Chapter One', 'Rain fell across Backlund.']);
    expect(activeIndices[activeIndices.length - 1]).toBe(2);

    // Completing block 2 skips divider (index 3) and speaks paragraph at index 4
    pendingOnDone?.();
    expect(spoken).toEqual(['Chapter One', 'Rain fell across Backlund.', 'The lamp stayed warm.']);

    // Completing last text block fires chapter auto-advance callback
    pendingOnDone?.();
    expect(chapterFinished).toBe(true);

    // Disabling stops driver cleanly
    tts.setEnabled(false);
    expect(tts.getState().enabled).toBe(false);
    expect(stopCount).toBeGreaterThan(0);
  });

  test('defaults auto-update cadence to 7 days and discovers only new chapters with discovered_at', async () => {
    expect(WEEKLY_UPDATE_INTERVAL_SECONDS).toBe(7 * 24 * 60 * 60);

    const db = createTestSqliteExecutor();
    try {
      await initDatabase(db);
      const novelId = await libraryRepo.upsertNovel(db, {
        pluginId: 'novelbin',
        path: '/lotm',
        title: 'Lord of the Mysteries',
        inLibrary: true,
      });
      await chapterRepo.upsertChapters(db, novelId, [
        { path: '/ch/1', name: 'Ch 1', chapterNumber: 1, discoveredAt: 1000 },
      ]);

      const plugin: PluginInstance = {
        id: 'novelbin',
        name: 'NovelBin',
        site: 'https://novelbin.example',
        version: '2.5.0',
        popularNovels: async () => [],
        searchNovels: async () => [],
        parseChapter: async () => '',
        parseNovel: async () => ({
          path: '/lotm',
          name: 'Lord of the Mysteries',
          chapters: [
            { path: '/ch/1', name: 'Ch 1', chapterNumber: 1 },
            { path: '/ch/2', name: 'Ch 2', chapterNumber: 2 },
            { path: '/ch/3', name: 'Ch 3', chapterNumber: 3 },
          ],
        }),
      };

      const report = await checkLibraryUpdates({
        db,
        getPlugin: async () => plugin,
        now: () => 5000,
        delayMs: 0,
      });

      expect(report.novelsChecked).toBe(1);
      expect(report.newChaptersTotal).toBe(2);
      expect(report.summaryText).toContain('2 new chapters');

      const updates = await chapterRepo.listRecentUpdates(db, 10);
      expect(updates.filter((u) => u.discovered_at === 5000)).toHaveLength(2);
    } finally {
      db.close();
    }
  });
});

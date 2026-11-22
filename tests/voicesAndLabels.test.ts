import { rankAndLabelVoices, sanitizeForSpeech, TTS_SPEED_PRESETS } from '@/reader/voiceCatalog';
import { TtsController, type SpeechDriver } from '@/reader/ttsController';
import { createTestSqliteExecutor } from './helpers/sqliteTestDb';
import { initDatabase } from '@/db/database';
import { libraryRepo } from '@/db/repositories/libraryRepo';

describe('Clean voice catalog, TTS speed/pitch, and Library labels', () => {
  test('ranks neural/enhanced voices ahead of legacy voices and gives them clean human names', () => {
    const raw = [
      { identifier: 'en-us-x-sfg-local', name: 'en-us-x-sfg-local', language: 'en-US', quality: 'Default' },
      { identifier: 'en-us-x-tpf-network', name: 'en-us-x-tpf-network', language: 'en-US', quality: 'Enhanced' },
      { identifier: 'en-gb-x-gba-network', name: 'en-gb-x-gba-network', language: 'en-GB', quality: 'Default' },
      { identifier: 'fr-fr-x-fra-local', name: 'fr-fr-x-fra-local', language: 'fr-FR', quality: 'Default' },
    ];

    const ranked = rankAndLabelVoices(raw);
    // English voices only by default, enhanced/network ranked first
    expect(ranked).toHaveLength(3);
    expect(ranked[0].identifier).toBe('en-us-x-tpf-network');
    expect(ranked[0].isNeural).toBe(true);
    expect(ranked[0].displayName).not.toContain('en-us-x-');
    expect(ranked[1].identifier).toBe('en-gb-x-gba-network');
    expect(ranked[2].identifier).toBe('en-us-x-sfg-local');
    expect(TTS_SPEED_PRESETS).toContain(0.75);
    expect(TTS_SPEED_PRESETS).toContain(1.0);
    expect(TTS_SPEED_PRESETS).toContain(1.25);
    expect(TTS_SPEED_PRESETS).toContain(2.0);
  });

  test('sanitizes chapter prose for natural speech without reading decorative dividers aloud', () => {
    expect(sanitizeForSpeech('***')).toBe('');
    expect(sanitizeForSpeech('=====')).toBe('');
    expect(sanitizeForSpeech('He paused...   "Wait—what?"  [TL: note]')).toBe(
      'He paused... "Wait, what?"'
    );
  });

  test('forwards speed and pitch to SpeechDriver and sanitizes spoken text', () => {
    const calls: Array<{ text: string; rate: number; pitch?: number }> = [];
    const driver: SpeechDriver = {
      speak(text, opts) {
        calls.push({ text, rate: opts.rate, pitch: opts.pitch });
      },
      stop() {},
    };

    const tts = new TtsController(driver);
    tts.loadBlocks([
      { type: 'paragraph', text: '***' },
      { type: 'paragraph', text: 'The lamp burned steadily.' },
    ]);
    tts.setEnabled(true);
    tts.setRate(1.35);
    tts.setPitch(0.95);
    tts.play();

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ text: 'The lamp burned steadily.', rate: 1.35, pitch: 0.95 });
  });

  test('migrates existing shelves table cleanly to support label colors, renaming, and novel-label lookup', async () => {
    const db = createTestSqliteExecutor();
    try {
      // Simulate existing on-device DB created BEFORE color_token existed
      await db.execAsync(`
        CREATE TABLE shelves (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL
        );
        INSERT INTO shelves (name, sort_order, created_at) VALUES ('Favorites', 0, 1000);
      `);

      // initDatabase must safely migrate without losing 'Favorites'
      await initDatabase(db);

      const created = await libraryRepo.createShelf(db, 'Peak Fiction', 'mint');
      expect(created.color_token).toBe('mint');

      await libraryRepo.renameShelf(db, created.id, 'Must Read', 'ochre');
      const all = await libraryRepo.listShelves(db);
      expect(all.find((s) => s.name === 'Favorites')).toBeTruthy();
      expect(all.find((s) => s.id === created.id)?.name).toBe('Must Read');
      expect(all.find((s) => s.id === created.id)?.color_token).toBe('ochre');

      const novelId = await libraryRepo.upsertNovel(db, {
        pluginId: 'royalroad',
        path: '/mol',
        title: 'Mother of Learning',
        inLibrary: true,
      });
      await libraryRepo.assignNovelToShelf(db, novelId, created.id);

      const labelMap = await libraryRepo.getLibraryLabelMap(db);
      expect(labelMap[novelId]?.map((l) => l.name)).toEqual(['Must Read']);
    } finally {
      db.close();
    }
  });
});

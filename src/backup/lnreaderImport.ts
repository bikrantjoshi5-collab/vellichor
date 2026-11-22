import JSZip from 'jszip';
import type { SqlExecutor } from '@/db/types';
import { libraryRepo } from '@/db/repositories/libraryRepo';
import { chapterRepo } from '@/db/repositories/chapterRepo';

interface LnNovelEntry {
  id: number;
  pluginId: string;
  path: string;
  name: string;
  author?: string;
  cover?: string;
  summary?: string;
  status?: string;
  inLibrary?: number | boolean;
}

interface LnChapterEntry {
  id?: number;
  novelId: number;
  path: string;
  name: string;
  chapterNumber?: number;
  releaseTime?: string;
  unread?: number | boolean;
  progress?: number;
}

interface LnCategoryEntry {
  id: number;
  name: string;
  novelIds?: number[];
}

interface ParsedLnArchive {
  novels: LnNovelEntry[];
  chapters: LnChapterEntry[];
  categories: LnCategoryEntry[];
  idToCanonicalKey: Map<number, string>;
}

async function readJsonFromZip<T>(zip: JSZip, candidateNames: string[]): Promise<T | null> {
  for (const name of candidateNames) {
    const file = zip.file(name) ?? zip.file(new RegExp(`(^|/)${name}$`, 'i'))[0];
    if (file) {
      const text = await file.async('text');
      try {
        return JSON.parse(text) as T;
      } catch {
        return null;
      }
    }
  }
  return null;
}

async function parseLnZip(bytes: Uint8Array | ArrayBuffer): Promise<ParsedLnArchive> {
  const zip = await JSZip.loadAsync(bytes);
  const rawNovels = (await readJsonFromZip<LnNovelEntry[]>(zip, ['Novel.json', 'novels.json'])) ?? [];
  const rawChapters = (await readJsonFromZip<LnChapterEntry[]>(zip, ['Chapter.json', 'chapters.json'])) ?? [];
  const rawCategories = (await readJsonFromZip<LnCategoryEntry[]>(zip, ['Category.json', 'categories.json'])) ?? [];

  // Deduplicate novels by (pluginId, path) cleanly
  const deduped = new Map<string, LnNovelEntry>();
  const idToCanonicalKey = new Map<number, string>();
  for (const n of rawNovels) {
    if (!n?.pluginId || !n?.path || !n?.name) continue;
    const key = `${n.pluginId}::${n.path}`;
    idToCanonicalKey.set(n.id, key);
    if (!deduped.has(key)) {
      deduped.set(key, n);
    }
  }

  return {
    novels: Array.from(deduped.values()),
    chapters: rawChapters.filter((c) => c && c.path && c.name),
    categories: rawCategories.filter((cat) => cat && cat.name),
    idToCanonicalKey,
  };
}

export interface LnImportPreview {
  novelsCount: number;
  chaptersCount: number;
  categoriesCount: number;
  sampleTitles: string[];
}

export async function previewLnReaderZip(bytes: Uint8Array | ArrayBuffer): Promise<LnImportPreview> {
  const parsed = await parseLnZip(bytes);
  return {
    novelsCount: parsed.novels.length,
    chaptersCount: parsed.chapters.length,
    categoriesCount: parsed.categories.length,
    sampleTitles: parsed.novels.slice(0, 5).map((n) => n.name),
  };
}

export async function importLnReaderZip(
  db: SqlExecutor,
  bytes: Uint8Array | ArrayBuffer
): Promise<{ novelsImported: number; chaptersImported: number; shelvesImported: number }> {
  const parsed = await parseLnZip(bytes);
  const keyToDbNovelId = new Map<string, number>();

  for (const n of parsed.novels) {
    const key = `${n.pluginId}::${n.path}`;
    const novelId = await libraryRepo.upsertNovel(db, {
      pluginId: n.pluginId,
      path: n.path,
      title: n.name,
      author: n.author ?? null,
      coverUrl: n.cover ?? null,
      summary: n.summary ?? null,
      sourceStatus: n.status ?? null,
      readingStatus: 'reading',
      inLibrary: n.inLibrary === undefined ? true : Boolean(n.inLibrary),
    });
    keyToDbNovelId.set(key, novelId);
  }

  // Group chapters by canonical DB novelId
  const chaptersByNovel = new Map<number, LnChapterEntry[]>();
  for (const ch of parsed.chapters) {
    const key = parsed.idToCanonicalKey.get(ch.novelId);
    if (!key) continue;
    const dbNovelId = keyToDbNovelId.get(key);
    if (!dbNovelId) continue;
    if (!chaptersByNovel.has(dbNovelId)) chaptersByNovel.set(dbNovelId, []);
    chaptersByNovel.get(dbNovelId)!.push(ch);
  }

  let chaptersImported = 0;
  for (const [novelId, list] of chaptersByNovel.entries()) {
    await chapterRepo.upsertChapters(
      db,
      novelId,
      list.map((c, idx) => ({
        path: c.path,
        name: c.name,
        chapterNumber: c.chapterNumber ?? idx + 1,
        releaseDate: c.releaseTime ?? null,
        isRead: c.unread === 0 || c.unread === false,
        readProgressPct: typeof c.progress === 'number' ? c.progress : c.unread === 0 ? 100 : 0,
      }))
    );
    chaptersImported += list.length;
  }

  let shelvesImported = 0;
  for (const cat of parsed.categories) {
    if (cat.name.toLowerCase() === 'default') continue;
    const shelf = await libraryRepo.createShelf(db, cat.name);
    shelvesImported++;
    for (const oldNovelId of cat.novelIds ?? []) {
      const key = parsed.idToCanonicalKey.get(oldNovelId);
      const dbNovelId = key ? keyToDbNovelId.get(key) : undefined;
      if (dbNovelId) {
        await libraryRepo.assignNovelToShelf(db, dbNovelId, shelf.id);
      }
    }
  }

  return {
    novelsImported: parsed.novels.length,
    chaptersImported,
    shelvesImported,
  };
}

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
  chapters?: LnChapterEntry[];
}

interface LnChapterEntry {
  id?: number;
  novelId?: number;
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
  chaptersByCanonicalKey: Map<string, LnChapterEntry[]>;
  categories: LnCategoryEntry[];
  idToCanonicalKey: Map<number, string>;
}

async function readJsonArrayFromZip<T>(zip: JSZip, candidateNames: string[]): Promise<T[]> {
  for (const name of candidateNames) {
    const file = zip.file(name) ?? zip.file(new RegExp(`(^|/)${name}$`, 'i'))[0];
    if (file) {
      try {
        const text = await file.async('text');
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) return parsed as T[];
      } catch {
        return [];
      }
    }
  }
  return [];
}

async function parseLnZip(bytes: Uint8Array | ArrayBuffer): Promise<ParsedLnArchive> {
  let zip = await JSZip.loadAsync(bytes);

  // Modern LNReader v2.x backups nest the database files inside a `data.zip` archive.
  const nestedDataZip = zip.file('data.zip') ?? zip.file(/(^|\/)data\.zip$/i)[0];
  if (nestedDataZip) {
    const innerBytes = await nestedDataZip.async('uint8array');
    zip = await JSZip.loadAsync(innerBytes);
  }

  const deduped = new Map<string, LnNovelEntry>();
  const idToCanonicalKey = new Map<number, string>();
  const chaptersByCanonicalKey = new Map<string, LnChapterEntry[]>();

  const registerNovel = (n: LnNovelEntry) => {
    if (!n?.pluginId || !n?.path || !n?.name) return null;
    const key = `${n.pluginId}::${n.path}`;
    if (typeof n.id === 'number') {
      idToCanonicalKey.set(n.id, key);
    }
    const existing = deduped.get(key);
    if (!existing) {
      deduped.set(key, n);
    } else if (!existing.inLibrary && n.inLibrary) {
      // Prefer inLibrary=true when deduplicating records
      deduped.set(key, { ...existing, ...n, inLibrary: true });
    }
    return key;
  };

  // Format A: LNReader v2.x per-novel files under NovelAndChapters/<id>.json
  const novelAndChapterFiles = zip.file(/(^|\/)NovelAndChapters\/[^/]+\.json$/i);
  for (const file of novelAndChapterFiles) {
    try {
      const text = await file.async('text');
      const obj = JSON.parse(text) as LnNovelEntry;
      if (!obj || typeof obj !== 'object') continue;
      const key = registerNovel(obj);
      if (key && Array.isArray(obj.chapters)) {
        const bucket = chaptersByCanonicalKey.get(key) ?? [];
        for (const ch of obj.chapters) {
          if (ch?.path && ch?.name) bucket.push(ch);
        }
        chaptersByCanonicalKey.set(key, bucket);
      }
    } catch {
      // Skip malformed individual JSON entry without aborting import
    }
  }

  // Format B: Flat Novel.json + Chapter.json
  const rawNovels = await readJsonArrayFromZip<LnNovelEntry>(zip, ['Novel.json', 'novels.json']);
  for (const n of rawNovels) {
    registerNovel(n);
  }

  const rawChapters = await readJsonArrayFromZip<LnChapterEntry>(zip, ['Chapter.json', 'chapters.json']);
  for (const ch of rawChapters) {
    if (!ch?.path || !ch?.name || typeof ch.novelId !== 'number') continue;
    const key = idToCanonicalKey.get(ch.novelId);
    if (!key) continue;
    const bucket = chaptersByCanonicalKey.get(key) ?? [];
    bucket.push(ch);
    chaptersByCanonicalKey.set(key, bucket);
  }

  const rawCategories = await readJsonArrayFromZip<LnCategoryEntry>(zip, ['Category.json', 'categories.json']);

  return {
    novels: Array.from(deduped.values()),
    chaptersByCanonicalKey,
    categories: rawCategories.filter((cat) => cat && typeof cat.name === 'string' && cat.name.trim().length > 0),
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
  let chaptersCount = 0;
  for (const list of parsed.chaptersByCanonicalKey.values()) {
    chaptersCount += list.length;
  }
  return {
    novelsCount: parsed.novels.length,
    chaptersCount,
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

  let chaptersImported = 0;
  for (const [key, list] of parsed.chaptersByCanonicalKey.entries()) {
    const novelId = keyToDbNovelId.get(key);
    if (!novelId) continue;
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
    for (const oldNovelId of Array.isArray(cat.novelIds) ? cat.novelIds : []) {
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

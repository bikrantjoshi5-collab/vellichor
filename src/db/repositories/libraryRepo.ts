import type { NovelRow, NovelWithStats, ReadingStatus, ShelfRow, SqlExecutor, SqlParam } from '../types';

export interface UpsertNovelInput {
  pluginId: string;
  path: string;
  title: string;
  author?: string | null;
  coverUrl?: string | null;
  localCoverPath?: string | null;
  summary?: string | null;
  sourceStatus?: string | null;
  readingStatus?: ReadingStatus;
  inLibrary?: boolean;
  lastReadAt?: number | null;
}

export interface LibraryFilter {
  readingStatus?: ReadingStatus | 'all' | 'downloaded';
  shelfId?: number | null;
  search?: string;
}

export const libraryRepo = {
  async upsertNovel(db: SqlExecutor, input: UpsertNovelInput): Promise<number> {
    const now = Date.now();
    const existing = await db.getFirstAsync<{ id: number }>(
      'SELECT id FROM novels WHERE plugin_id = ? AND path = ?',
      [input.pluginId, input.path]
    );

    if (existing) {
      await db.runAsync(
        `UPDATE novels SET
          title = ?,
          author = COALESCE(?, author),
          cover_url = COALESCE(?, cover_url),
          local_cover_path = COALESCE(?, local_cover_path),
          summary = COALESCE(?, summary),
          source_status = COALESCE(?, source_status),
          reading_status = COALESCE(?, reading_status),
          in_library = COALESCE(?, in_library),
          last_read_at = COALESCE(?, last_read_at)
        WHERE id = ?`,
        [
          input.title,
          input.author ?? null,
          input.coverUrl ?? null,
          input.localCoverPath ?? null,
          input.summary ?? null,
          input.sourceStatus ?? null,
          input.readingStatus ?? null,
          input.inLibrary === undefined ? null : input.inLibrary ? 1 : 0,
          input.lastReadAt ?? null,
          existing.id,
        ]
      );
      return existing.id;
    }

    const res = await db.runAsync(
      `INSERT INTO novels (
        plugin_id, path, title, author, cover_url, local_cover_path, summary,
        source_status, reading_status, in_library, last_read_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.pluginId,
        input.path,
        input.title,
        input.author ?? null,
        input.coverUrl ?? null,
        input.localCoverPath ?? null,
        input.summary ?? null,
        input.sourceStatus ?? null,
        input.readingStatus ?? 'reading',
        input.inLibrary ? 1 : 0,
        input.lastReadAt ?? null,
        now,
      ]
    );
    return res.lastInsertRowId;
  },

  async getNovelById(db: SqlExecutor, id: number): Promise<NovelRow | null> {
    return db.getFirstAsync<NovelRow>('SELECT * FROM novels WHERE id = ?', [id]);
  },

  async getNovelByPath(db: SqlExecutor, pluginId: string, path: string): Promise<NovelRow | null> {
    return db.getFirstAsync<NovelRow>('SELECT * FROM novels WHERE plugin_id = ? AND path = ?', [pluginId, path]);
  },

  async setInLibrary(db: SqlExecutor, novelId: number, inLibrary: boolean): Promise<void> {
    await db.runAsync('UPDATE novels SET in_library = ? WHERE id = ?', [inLibrary ? 1 : 0, novelId]);
  },

  async setReadingStatus(db: SqlExecutor, novelId: number, status: ReadingStatus): Promise<void> {
    await db.runAsync('UPDATE novels SET reading_status = ? WHERE id = ?', [status, novelId]);
  },

  async touchLastRead(db: SqlExecutor, novelId: number, timestamp = Date.now()): Promise<void> {
    await db.runAsync('UPDATE novels SET last_read_at = ? WHERE id = ?', [timestamp, novelId]);
  },

  async listLibraryNovels(db: SqlExecutor, filter: LibraryFilter = {}): Promise<NovelWithStats[]> {
    const clauses: string[] = ['n.in_library = 1'];
    const params: SqlParam[] = [];

    if (filter.readingStatus && filter.readingStatus !== 'all' && filter.readingStatus !== 'downloaded') {
      clauses.push('n.reading_status = ?');
      params.push(filter.readingStatus);
    }
    if (filter.shelfId) {
      clauses.push('EXISTS (SELECT 1 FROM novel_shelves ns WHERE ns.novel_id = n.id AND ns.shelf_id = ?)');
      params.push(filter.shelfId);
    }
    if (filter.search?.trim()) {
      clauses.push('(n.title LIKE ? OR COALESCE(n.author, \'\') LIKE ?)');
      const q = `%${filter.search.trim()}%`;
      params.push(q, q);
    }

    const havingClause = filter.readingStatus === 'downloaded' ? 'HAVING downloaded_chapters > 0' : '';

    return db.getAllAsync<NovelWithStats>(
      `SELECT
        n.*,
        COUNT(c.id) AS total_chapters,
        COALESCE(SUM(CASE WHEN c.is_read = 1 THEN 1 ELSE 0 END), 0) AS read_chapters,
        COALESCE(SUM(CASE WHEN c.is_read = 0 THEN 1 ELSE 0 END), 0) AS unread_chapters,
        COALESCE(SUM(CASE WHEN c.is_downloaded = 1 THEN 1 ELSE 0 END), 0) AS downloaded_chapters,
        COALESCE(
          (SELECT ch.name FROM reading_history rh INNER JOIN chapters ch ON ch.id = rh.chapter_id WHERE rh.novel_id = n.id ORDER BY rh.read_at DESC LIMIT 1),
          (SELECT ch.name FROM chapters ch WHERE ch.novel_id = n.id ORDER BY ch.updated_at DESC, ch.chapter_number DESC LIMIT 1)
        ) AS last_chapter_name,
        COALESCE(
          (SELECT rh.chapter_id FROM reading_history rh WHERE rh.novel_id = n.id ORDER BY rh.read_at DESC LIMIT 1),
          (SELECT ch.id FROM chapters ch WHERE ch.novel_id = n.id ORDER BY ch.updated_at DESC, ch.chapter_number DESC LIMIT 1)
        ) AS last_chapter_id,
        COALESCE(
          (SELECT ch.read_progress_pct FROM reading_history rh INNER JOIN chapters ch ON ch.id = rh.chapter_id WHERE rh.novel_id = n.id ORDER BY rh.read_at DESC LIMIT 1),
          0
        ) AS last_chapter_progress_pct
      FROM novels n
      LEFT JOIN chapters c ON c.novel_id = n.id
      WHERE ${clauses.join(' AND ')}
      GROUP BY n.id
      ${havingClause}
      ORDER BY COALESCE(n.last_read_at, 0) DESC, n.created_at DESC`,
      params
    );
  },

  async createShelf(db: SqlExecutor, name: string, colorToken = 'terracotta'): Promise<ShelfRow> {
    const trimmed = name.trim();
    const existing = await db.getFirstAsync<ShelfRow>('SELECT * FROM shelves WHERE name = ?', [trimmed]);
    if (existing) return existing;
    const countRow = await db.getFirstAsync<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM shelves');
    const now = Date.now();
    const res = await db.runAsync(
      'INSERT INTO shelves (name, color_token, sort_order, created_at) VALUES (?, ?, ?, ?)',
      [trimmed, colorToken, countRow?.cnt ?? 0, now]
    );
    return {
      id: res.lastInsertRowId,
      name: trimmed,
      color_token: colorToken,
      sort_order: countRow?.cnt ?? 0,
      created_at: now,
    };
  },

  async renameShelf(db: SqlExecutor, shelfId: number, name: string, colorToken?: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (colorToken) {
      await db.runAsync('UPDATE shelves SET name = ?, color_token = ? WHERE id = ?', [
        trimmed,
        colorToken,
        shelfId,
      ]);
    } else {
      await db.runAsync('UPDATE shelves SET name = ? WHERE id = ?', [trimmed, shelfId]);
    }
  },

  async listShelves(db: SqlExecutor): Promise<ShelfRow[]> {
    return db.getAllAsync<ShelfRow>('SELECT * FROM shelves ORDER BY sort_order ASC, name ASC');
  },

  async getLibraryLabelMap(db: SqlExecutor): Promise<Record<number, ShelfRow[]>> {
    const rows = await db.getAllAsync<ShelfRow & { novel_id: number }>(
      `SELECT ns.novel_id, s.*
       FROM novel_shelves ns
       INNER JOIN shelves s ON s.id = ns.shelf_id
       ORDER BY s.sort_order ASC, s.name ASC`
    );
    const map: Record<number, ShelfRow[]> = {};
    for (const r of rows) {
      if (!map[r.novel_id]) map[r.novel_id] = [];
      map[r.novel_id].push({
        id: r.id,
        name: r.name,
        color_token: r.color_token || 'terracotta',
        sort_order: r.sort_order,
        created_at: r.created_at,
      });
    }
    return map;
  },

  async deleteShelf(db: SqlExecutor, shelfId: number): Promise<void> {
    await db.runAsync('DELETE FROM shelves WHERE id = ?', [shelfId]);
  },

  async assignNovelToShelf(db: SqlExecutor, novelId: number, shelfId: number): Promise<void> {
    await db.runAsync(
      'INSERT OR IGNORE INTO novel_shelves (novel_id, shelf_id) VALUES (?, ?)',
      [novelId, shelfId]
    );
  },

  async removeNovelFromShelf(db: SqlExecutor, novelId: number, shelfId: number): Promise<void> {
    await db.runAsync('DELETE FROM novel_shelves WHERE novel_id = ? AND shelf_id = ?', [novelId, shelfId]);
  },

  async getShelvesForNovel(db: SqlExecutor, novelId: number): Promise<ShelfRow[]> {
    return db.getAllAsync<ShelfRow>(
      `SELECT s.* FROM shelves s
       INNER JOIN novel_shelves ns ON ns.shelf_id = s.id
       WHERE ns.novel_id = ?
       ORDER BY s.sort_order ASC, s.name ASC`,
      [novelId]
    );
  },
};

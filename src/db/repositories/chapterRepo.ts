import type { ChapterRow, ChapterUpdateRow, SqlExecutor } from '../types';

export interface UpsertChapterInput {
  path: string;
  name: string;
  chapterNumber?: number;
  releaseDate?: string | null;
  discoveredAt?: number;
  isRead?: boolean;
  readProgressPct?: number;
  scrollParagraphIdx?: number;
}

export const chapterRepo = {
  async upsertChapters(
    db: SqlExecutor,
    novelId: number,
    chapters: UpsertChapterInput[]
  ): Promise<{ inserted: number; total: number }> {
    if (chapters.length === 0) return { inserted: 0, total: 0 };
    let inserted = 0;
    const now = Date.now();
    await db.execAsync('BEGIN TRANSACTION');
    try {
      for (let i = 0; i < chapters.length; i++) {
        const ch = chapters[i];
        const existing = await db.getFirstAsync<{ id: number }>(
          'SELECT id FROM chapters WHERE novel_id = ? AND path = ?',
          [novelId, ch.path]
        );
        const chNum = ch.chapterNumber ?? i + 1;
        if (existing) {
          await db.runAsync(
            `UPDATE chapters SET
              name = ?,
              chapter_number = ?,
              release_date = COALESCE(?, release_date),
              is_read = COALESCE(?, is_read),
              read_progress_pct = COALESCE(?, read_progress_pct),
              scroll_paragraph_idx = COALESCE(?, scroll_paragraph_idx)
            WHERE id = ?`,
            [
              ch.name,
              chNum,
              ch.releaseDate ?? null,
              ch.isRead === undefined ? null : ch.isRead ? 1 : 0,
              ch.readProgressPct ?? null,
              ch.scrollParagraphIdx ?? null,
              existing.id,
            ]
          );
        } else {
          await db.runAsync(
            `INSERT INTO chapters (
              novel_id, path, name, chapter_number, release_date, discovered_at,
              is_read, read_progress_pct, scroll_paragraph_idx, is_downloaded, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
            [
              novelId,
              ch.path,
              ch.name,
              chNum,
              ch.releaseDate ?? null,
              ch.discoveredAt ?? now,
              ch.isRead ? 1 : 0,
              ch.readProgressPct ?? 0,
              ch.scrollParagraphIdx ?? 0,
              now,
            ]
          );
          inserted++;
        }
      }
      await db.execAsync('COMMIT');
    } catch (err) {
      await db.execAsync('ROLLBACK').catch(() => {});
      throw err;
    }
    return { inserted, total: chapters.length };
  },

  async markReadUpToChapter(db: SqlExecutor, novelId: number, maxChapterNumber: number): Promise<void> {
    await db.runAsync(
      `UPDATE chapters SET is_read = 1, read_progress_pct = 100, updated_at = ?
       WHERE novel_id = ? AND chapter_number <= ?`,
      [Date.now(), novelId, maxChapterNumber]
    );
  },

  async listByNovel(db: SqlExecutor, novelId: number, order: 'asc' | 'desc' = 'asc'): Promise<ChapterRow[]> {
    const dir = order === 'desc' ? 'DESC' : 'ASC';
    return db.getAllAsync<ChapterRow>(
      `SELECT * FROM chapters WHERE novel_id = ? ORDER BY chapter_number ${dir}, id ${dir}`,
      [novelId]
    );
  },

  async getChapterById(db: SqlExecutor, id: number): Promise<ChapterRow | null> {
    return db.getFirstAsync<ChapterRow>('SELECT * FROM chapters WHERE id = ?', [id]);
  },

  async getAdjacentChapters(
    db: SqlExecutor,
    novelId: number,
    chapterId: number
  ): Promise<{ prev: ChapterRow | null; next: ChapterRow | null }> {
    const list = await chapterRepo.listByNovel(db, novelId, 'asc');
    const idx = list.findIndex((c) => c.id === chapterId);
    if (idx === -1) return { prev: null, next: null };
    return {
      prev: idx > 0 ? list[idx - 1] : null,
      next: idx < list.length - 1 ? list[idx + 1] : null,
    };
  },

  async saveReadProgress(
    db: SqlExecutor,
    chapterId: number,
    progress: { isRead: boolean; readProgressPct: number; scrollParagraphIdx: number }
  ): Promise<void> {
    await db.runAsync(
      `UPDATE chapters SET
        is_read = ?,
        read_progress_pct = ?,
        scroll_paragraph_idx = ?,
        updated_at = ?
      WHERE id = ?`,
      [
        progress.isRead ? 1 : 0,
        Math.max(0, Math.min(100, progress.readProgressPct)),
        Math.max(0, progress.scrollParagraphIdx),
        Date.now(),
        chapterId,
      ]
    );
  },

  async markDownloaded(
    db: SqlExecutor,
    chapterId: number,
    contentPath: string,
    assetsDir: string
  ): Promise<void> {
    await db.runAsync(
      `UPDATE chapters SET
        is_downloaded = 1,
        content_path = ?,
        assets_dir = ?,
        updated_at = ?
      WHERE id = ?`,
      [contentPath, assetsDir, Date.now(), chapterId]
    );
  },

  async clearDownloaded(db: SqlExecutor, chapterId: number): Promise<void> {
    await db.runAsync(
      `UPDATE chapters SET
        is_downloaded = 0,
        content_path = NULL,
        assets_dir = NULL,
        updated_at = ?
      WHERE id = ?`,
      [Date.now(), chapterId]
    );
  },

  async listRecentUpdates(db: SqlExecutor, limit = 80): Promise<ChapterUpdateRow[]> {
    return db.getAllAsync<ChapterUpdateRow>(
      `SELECT
        c.*,
        n.title AS novel_title,
        n.cover_url AS novel_cover_url,
        n.plugin_id AS novel_plugin_id
      FROM chapters c
      INNER JOIN novels n ON n.id = c.novel_id
      WHERE n.in_library = 1
      ORDER BY c.discovered_at DESC, c.chapter_number DESC
      LIMIT ?`,
      [limit]
    );
  },
};

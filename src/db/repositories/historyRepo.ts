import type { ReadingHistoryRow, SqlExecutor } from '../types';

export const historyRepo = {
  async recordSession(
    db: SqlExecutor,
    input: { novelId: number; chapterId: number; durationSec?: number; readAt?: number }
  ): Promise<void> {
    await db.runAsync(
      'INSERT INTO reading_history (novel_id, chapter_id, read_at, duration_sec) VALUES (?, ?, ?, ?)',
      [input.novelId, input.chapterId, input.readAt ?? Date.now(), input.durationSec ?? 0]
    );
  },

  async listRecent(db: SqlExecutor, limit = 60): Promise<ReadingHistoryRow[]> {
    return db.getAllAsync<ReadingHistoryRow>(
      `SELECT
        h.*,
        n.title AS novel_title,
        n.cover_url AS novel_cover_url,
        c.name AS chapter_name
      FROM reading_history h
      INNER JOIN novels n ON n.id = h.novel_id
      INNER JOIN chapters c ON c.id = h.chapter_id
      ORDER BY h.read_at DESC
      LIMIT ?`,
      [limit]
    );
  },

  async clearHistory(db: SqlExecutor): Promise<void> {
    await db.runAsync('DELETE FROM reading_history');
  },
};

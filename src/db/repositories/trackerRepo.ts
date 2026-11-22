import type { ReadingStatus, SqlExecutor, TrackerLinkRow, TrackerProvider } from '../types';

export interface UpsertTrackerLinkInput {
  novelId: number;
  provider: TrackerProvider;
  remoteId: string;
  remoteTitle: string;
  remoteUrl?: string | null;
  status?: ReadingStatus;
  lastChapterSynced?: number;
  volumeProgress?: number;
  chapterOffset?: number;
  score?: number;
  pendingSync?: boolean;
}

export const trackerRepo = {
  async upsertLink(db: SqlExecutor, input: UpsertTrackerLinkInput): Promise<void> {
    const now = Date.now();
    await db.runAsync(
      `INSERT INTO tracker_links (
        novel_id, provider, remote_id, remote_title, remote_url, status,
        last_chapter_synced, volume_progress, chapter_offset, score, pending_sync, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(novel_id, provider) DO UPDATE SET
        remote_id = excluded.remote_id,
        remote_title = excluded.remote_title,
        remote_url = COALESCE(excluded.remote_url, tracker_links.remote_url),
        status = excluded.status,
        last_chapter_synced = excluded.last_chapter_synced,
        volume_progress = excluded.volume_progress,
        chapter_offset = excluded.chapter_offset,
        score = excluded.score,
        pending_sync = excluded.pending_sync,
        updated_at = excluded.updated_at`,
      [
        input.novelId,
        input.provider,
        input.remoteId,
        input.remoteTitle,
        input.remoteUrl ?? null,
        input.status ?? 'reading',
        input.lastChapterSynced ?? 0,
        input.volumeProgress ?? 0,
        input.chapterOffset ?? 0,
        input.score ?? 0,
        input.pendingSync ? 1 : 0,
        now,
      ]
    );
  },

  async getLink(db: SqlExecutor, novelId: number, provider: TrackerProvider): Promise<TrackerLinkRow | null> {
    return db.getFirstAsync<TrackerLinkRow>(
      'SELECT * FROM tracker_links WHERE novel_id = ? AND provider = ?',
      [novelId, provider]
    );
  },

  async listByNovel(db: SqlExecutor, novelId: number): Promise<TrackerLinkRow[]> {
    return db.getAllAsync<TrackerLinkRow>('SELECT * FROM tracker_links WHERE novel_id = ?', [novelId]);
  },

  async listAll(db: SqlExecutor): Promise<TrackerLinkRow[]> {
    return db.getAllAsync<TrackerLinkRow>('SELECT * FROM tracker_links ORDER BY updated_at DESC');
  },

  async listPendingSync(db: SqlExecutor): Promise<TrackerLinkRow[]> {
    return db.getAllAsync<TrackerLinkRow>('SELECT * FROM tracker_links WHERE pending_sync = 1');
  },

  async setPendingSync(
    db: SqlExecutor,
    linkId: number,
    pending: boolean,
    syncedChapter?: number,
    pendingChapter?: number | null
  ): Promise<void> {
    if (syncedChapter !== undefined) {
      await db.runAsync(
        'UPDATE tracker_links SET pending_sync = ?, last_chapter_synced = ?, pending_chapter = ?, updated_at = ? WHERE id = ?',
        [pending ? 1 : 0, syncedChapter, pending ? (pendingChapter ?? null) : null, Date.now(), linkId]
      );
    } else {
      await db.runAsync(
        'UPDATE tracker_links SET pending_sync = ?, pending_chapter = ?, updated_at = ? WHERE id = ?',
        [pending ? 1 : 0, pending ? (pendingChapter ?? null) : null, Date.now(), linkId]
      );
    }
  },

  async updateLinkTuning(
    db: SqlExecutor,
    linkId: number,
    tuning: { chapterOffset?: number; volumeProgress?: number; score?: number; status?: ReadingStatus }
  ): Promise<void> {
    await db.runAsync(
      `UPDATE tracker_links SET
        chapter_offset = COALESCE(?, chapter_offset),
        volume_progress = COALESCE(?, volume_progress),
        score = COALESCE(?, score),
        status = COALESCE(?, status),
        updated_at = ?
      WHERE id = ?`,
      [
        tuning.chapterOffset ?? null,
        tuning.volumeProgress ?? null,
        tuning.score ?? null,
        tuning.status ?? null,
        Date.now(),
        linkId,
      ]
    );
  },

  async removeLink(db: SqlExecutor, novelId: number, provider: TrackerProvider): Promise<void> {
    await db.runAsync('DELETE FROM tracker_links WHERE novel_id = ? AND provider = ?', [novelId, provider]);
  },
};

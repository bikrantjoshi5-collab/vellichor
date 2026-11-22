import type { DownloadJobRow, DownloadJobStatus, SqlExecutor } from '../types';

export const downloadRepo = {
  async enqueueJob(
    db: SqlExecutor,
    input: { chapterId: number; novelId: number; pluginId: string }
  ): Promise<number> {
    const now = Date.now();
    const existing = await db.getFirstAsync<DownloadJobRow>(
      'SELECT * FROM download_jobs WHERE chapter_id = ?',
      [input.chapterId]
    );
    if (existing) {
      await db.runAsync(
        `UPDATE download_jobs SET status = 'pending', attempt_count = 0, next_retry_at = NULL, last_error = NULL WHERE id = ?`,
        [existing.id]
      );
      return existing.id;
    }

    const res = await db.runAsync(
      `INSERT INTO download_jobs (chapter_id, novel_id, plugin_id, status, attempt_count, created_at)
       VALUES (?, ?, ?, 'pending', 0, ?)`,
      [input.chapterId, input.novelId, input.pluginId, now]
    );
    return res.lastInsertRowId;
  },

  async updateJobStatus(
    db: SqlExecutor,
    jobId: number,
    status: DownloadJobStatus,
    extra: { attemptCount?: number; nextRetryAt?: number | null; lastError?: string | null } = {}
  ): Promise<void> {
    await db.runAsync(
      `UPDATE download_jobs SET
        status = ?,
        attempt_count = COALESCE(?, attempt_count),
        next_retry_at = ?,
        last_error = ?
      WHERE id = ?`,
      [
        status,
        extra.attemptCount ?? null,
        extra.nextRetryAt === undefined ? null : extra.nextRetryAt,
        extra.lastError === undefined ? null : extra.lastError,
        jobId,
      ]
    );
  },

  async listJobs(db: SqlExecutor, statuses?: DownloadJobStatus[]): Promise<DownloadJobRow[]> {
    if (!statuses || statuses.length === 0) {
      return db.getAllAsync<DownloadJobRow>('SELECT * FROM download_jobs ORDER BY id ASC');
    }
    const placeholders = statuses.map(() => '?').join(', ');
    return db.getAllAsync<DownloadJobRow>(
      `SELECT * FROM download_jobs WHERE status IN (${placeholders}) ORDER BY id ASC`,
      statuses
    );
  },

  async listRunnableJobs(db: SqlExecutor, nowMs: number): Promise<DownloadJobRow[]> {
    // Exclude any plugin currently blocked on Cloudflare (cf_required) or actively cooling down (rate_limited > nowMs)
    return db.getAllAsync<DownloadJobRow>(
      `SELECT j.* FROM download_jobs j
       WHERE (j.status = 'pending' OR (j.status = 'rate_limited' AND COALESCE(j.next_retry_at, 0) <= ?))
         AND NOT EXISTS (
           SELECT 1 FROM download_jobs b
           WHERE b.plugin_id = j.plugin_id
             AND (b.status = 'cf_required' OR (b.status = 'rate_limited' AND COALESCE(b.next_retry_at, 0) > ?))
         )
       ORDER BY j.id ASC`,
      [nowMs, nowMs]
    );
  },

  async getEarliestRetryAt(db: SqlExecutor): Promise<number | null> {
    const row = await db.getFirstAsync<{ min_retry: number | null }>(
      `SELECT MIN(next_retry_at) AS min_retry FROM download_jobs WHERE status = 'rate_limited' AND next_retry_at IS NOT NULL`
    );
    return row?.min_retry ?? null;
  },

  async resetInterruptedJobs(db: SqlExecutor): Promise<number> {
    const res = await db.runAsync(`UPDATE download_jobs SET status = 'pending' WHERE status = 'running'`);
    return res.changes;
  },

  async pauseAll(db: SqlExecutor): Promise<void> {
    await db.runAsync(`UPDATE download_jobs SET status = 'paused' WHERE status IN ('pending', 'rate_limited')`);
  },

  async resumeAll(db: SqlExecutor): Promise<void> {
    await db.runAsync(`UPDATE download_jobs SET status = 'pending', next_retry_at = NULL WHERE status = 'paused'`);
  },

  async retryAllFailed(db: SqlExecutor): Promise<void> {
    await db.runAsync(
      `UPDATE download_jobs SET status = 'pending', attempt_count = 0, next_retry_at = NULL, last_error = NULL
       WHERE status IN ('failed', 'rate_limited')`
    );
  },

  async resumeCloudflareForPlugin(db: SqlExecutor, pluginId: string): Promise<void> {
    await db.runAsync(
      `UPDATE download_jobs SET status = 'pending', attempt_count = 0, next_retry_at = NULL, last_error = NULL
       WHERE plugin_id = ? AND status = 'cf_required'`,
      [pluginId]
    );
  },

  async cancelByNovel(db: SqlExecutor, novelId: number): Promise<void> {
    await db.runAsync(`DELETE FROM download_jobs WHERE novel_id = ? AND status != 'completed'`, [novelId]);
  },

  async clearCompleted(db: SqlExecutor): Promise<void> {
    await db.runAsync(`DELETE FROM download_jobs WHERE status = 'completed'`);
  },
};

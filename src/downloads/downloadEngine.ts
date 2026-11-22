import type { DownloadJobRow, SqlExecutor } from '@/db/types';
import { chapterRepo } from '@/db/repositories/chapterRepo';
import { downloadRepo } from '@/db/repositories/downloadRepo';
import { DEFAULT_USER_AGENT } from '@/plugins/shims';
import type { PluginInstance } from '@/plugins/types';
import { parseChapterHtml, type ChapterBlock } from '@/reader/chapterParser';

export interface AssetFileStore {
  writeChapterContent(
    novelId: number,
    chapterId: number,
    json: string
  ): Promise<{ contentPath: string; assetsDir: string }>;
  downloadIllustration(
    novelId: number,
    chapterId: number,
    index: number,
    url: string,
    headers: Record<string, string>
  ): Promise<string>;
  deleteDirectory(dirPath: string): Promise<void>;
}

export interface DownloadEngineOptions {
  db: SqlExecutor;
  assetStore: AssetFileStore;
  getPlugin: (pluginId: string) => Promise<PluginInstance>;
  maxConcurrentPerSource?: number;
  maxGlobalSources?: number;
  politeDelayMs?: number;
  maxRetries?: number;
  backoffScheduleMs?: number[];
  now?: () => number;
  onProgress?: () => void;
}

export interface TickResult {
  processed: number;
  completed: number;
  failed: number;
  rateLimited: number;
  cloudflarePaused: number;
  warnings: string[];
}

const DEFAULT_BACKOFF_MS = [3_000, 10_000, 30_000];

function classifyError(err: unknown): {
  kind: 'cloudflare' | 'rate_limit' | 'transient' | 'fatal';
  message: string;
} {
  const anyErr = err as { status?: number; isCloudflare?: boolean; message?: string } | null;
  const msg = anyErr?.message ? String(anyErr.message) : String(err);
  if (anyErr?.isCloudflare || anyErr?.status === 403) {
    return { kind: 'cloudflare', message: msg || 'Cloudflare verification required' };
  }
  if (anyErr?.status === 429 || /\b429\b/i.test(msg)) {
    return { kind: 'rate_limit', message: msg || 'HTTP 429 rate limited' };
  }
  if ((anyErr?.status && anyErr.status >= 500) || /timeout|network|fetch/i.test(msg)) {
    return { kind: 'transient', message: msg };
  }
  return { kind: 'fatal', message: msg };
}

export class DownloadEngine {
  private readonly db: SqlExecutor;
  private readonly assetStore: AssetFileStore;
  private readonly getPlugin: (pluginId: string) => Promise<PluginInstance>;
  private readonly maxConcurrentPerSource: number;
  private readonly maxGlobalSources: number;
  private readonly politeDelayMs: number;
  private readonly maxRetries: number;
  private readonly backoffScheduleMs: number[];
  private readonly now: () => number;
  private readonly onProgress?: () => void;
  private runningLoop = false;
  private paused = false;
  private sleepCancel: (() => void) | null = null;

  constructor(options: DownloadEngineOptions) {
    this.db = options.db;
    this.assetStore = options.assetStore;
    this.getPlugin = options.getPlugin;
    this.maxConcurrentPerSource = Math.max(1, options.maxConcurrentPerSource ?? 1);
    this.maxGlobalSources = Math.max(1, options.maxGlobalSources ?? 2);
    this.politeDelayMs = options.politeDelayMs ?? 750;
    this.maxRetries = options.maxRetries ?? 3;
    this.backoffScheduleMs = options.backoffScheduleMs ?? DEFAULT_BACKOFF_MS;
    this.now = options.now ?? (() => Date.now());
    this.onProgress = options.onProgress;
  }

  private cancellableSleep(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.sleepCancel = null;
        resolve();
      }, ms);
      this.sleepCancel = () => {
        clearTimeout(timer);
        this.sleepCancel = null;
        resolve();
      };
    });
  }

  async recoverInterrupted(): Promise<number> {
    return downloadRepo.resetInterruptedJobs(this.db);
  }

  async enqueueChapters(novelId: number, pluginId: string, chapterIds: number[]): Promise<number> {
    let count = 0;
    for (const chapterId of chapterIds) {
      await downloadRepo.enqueueJob(this.db, { chapterId, novelId, pluginId });
      count++;
    }
    this.onProgress?.();
    return count;
  }

  async pauseAll(): Promise<void> {
    this.paused = true;
    this.sleepCancel?.();
    await downloadRepo.pauseAll(this.db);
    this.onProgress?.();
  }

  async resumeAll(): Promise<void> {
    this.paused = false;
    await downloadRepo.resumeAll(this.db);
    this.onProgress?.();
  }

  async retryFailed(): Promise<void> {
    await downloadRepo.retryAllFailed(this.db);
    this.onProgress?.();
  }

  async clearCloudflareForSource(pluginId: string): Promise<void> {
    await downloadRepo.resumeCloudflareForPlugin(this.db, pluginId);
    this.onProgress?.();
  }

  async cancelNovelBatch(novelId: number): Promise<void> {
    await downloadRepo.cancelByNovel(this.db, novelId);
    this.onProgress?.();
  }

  async deleteChapterAssets(chapterId: number): Promise<void> {
    const ch = await chapterRepo.getChapterById(this.db, chapterId);
    if (ch?.assets_dir) {
      await this.assetStore.deleteDirectory(ch.assets_dir);
    }
    await chapterRepo.clearDownloaded(this.db, chapterId);
    this.onProgress?.();
  }

  /**
   * Executes one bounded wave of runnable jobs, respecting per-source and global source caps.
   * Isolates per-source failures (429 backoff / 403 Cloudflare) so healthy sources never stall.
   */
  async processNextTick(): Promise<TickResult> {
    const result: TickResult = {
      processed: 0,
      completed: 0,
      failed: 0,
      rateLimited: 0,
      cloudflarePaused: 0,
      warnings: [],
    };
    if (this.paused) return result;

    const runnable = await downloadRepo.listRunnableJobs(this.db, this.now());
    if (runnable.length === 0) return result;

    const byPlugin = new Map<string, DownloadJobRow[]>();
    for (const job of runnable) {
      if (!byPlugin.has(job.plugin_id)) {
        if (byPlugin.size >= this.maxGlobalSources) continue;
        byPlugin.set(job.plugin_id, []);
      }
      const bucket = byPlugin.get(job.plugin_id)!;
      if (bucket.length < this.maxConcurrentPerSource) {
        bucket.push(job);
      }
    }

    const batch = Array.from(byPlugin.values()).flat();
    await Promise.all(
      batch.map(async (job) => {
        result.processed++;
        await this.executeJob(job, result);
      })
    );

    if (this.politeDelayMs > 0 && result.processed > 0) {
      const jitter = Math.floor(Math.random() * Math.min(400, this.politeDelayMs));
      await this.cancellableSleep(this.politeDelayMs + jitter);
    }

    this.onProgress?.();
    return result;
  }

  /**
   * Continuously processes pending jobs AND sleeps cleanly for scheduled 429/5xx backoff retries
   * until all non-paused / non-Cloudflare jobs settle.
   */
  async startLoop(): Promise<void> {
    if (this.runningLoop) return;
    this.runningLoop = true;
    try {
      while (!this.paused) {
        const tick = await this.processNextTick();
        if (tick.processed > 0) continue;

        const nextRetryAt = await downloadRepo.getEarliestRetryAt(this.db);
        if (nextRetryAt === null) break;

        const waitMs = Math.max(10, nextRetryAt - this.now());
        await this.cancellableSleep(waitMs);
      }
    } finally {
      this.runningLoop = false;
    }
  }

  private async executeJob(job: DownloadJobRow, result: TickResult): Promise<void> {
    await downloadRepo.updateJobStatus(this.db, job.id, 'running');
    try {
      const chapter = await chapterRepo.getChapterById(this.db, job.chapter_id);
      if (!chapter) {
        await downloadRepo.updateJobStatus(this.db, job.id, 'failed', {
          lastError: 'Chapter no longer exists in database',
        });
        result.failed++;
        return;
      }

      const plugin = await this.getPlugin(job.plugin_id);
      const html = await plugin.parseChapter(chapter.path);
      const blocks = parseChapterHtml(html, plugin.site || undefined);

      // Phase 2: Cache light novel illustrations locally; single broken image logs warning without failing chapter text.
      let imgIndex = 0;
      const rewritten: ChapterBlock[] = [];
      for (const block of blocks) {
        if (block.type !== 'image') {
          rewritten.push(block);
          continue;
        }
        try {
          const localUri = await this.assetStore.downloadIllustration(
            job.novel_id,
            job.chapter_id,
            imgIndex++,
            block.uri,
            {
              'User-Agent': DEFAULT_USER_AGENT,
              ...(plugin.site ? { Referer: plugin.site } : {}),
            }
          );
          rewritten.push({ ...block, uri: localUri });
        } catch (imgErr) {
          const warnMsg = `Illustration failed (${block.uri}): ${
            imgErr instanceof Error ? imgErr.message : String(imgErr)
          }`;
          result.warnings.push(warnMsg);
          rewritten.push(block);
        }
      }

      const { contentPath, assetsDir } = await this.assetStore.writeChapterContent(
        job.novel_id,
        job.chapter_id,
        JSON.stringify(rewritten)
      );
      await chapterRepo.markDownloaded(this.db, job.chapter_id, contentPath, assetsDir);
      await downloadRepo.updateJobStatus(this.db, job.id, 'completed', {
        attemptCount: job.attempt_count + 1,
        nextRetryAt: null,
        lastError: null,
      });
      result.completed++;
    } catch (err) {
      const classified = classifyError(err);
      const nextAttempt = job.attempt_count + 1;

      if (classified.kind === 'cloudflare') {
        await downloadRepo.updateJobStatus(this.db, job.id, 'cf_required', {
          attemptCount: nextAttempt,
          nextRetryAt: null,
          lastError: classified.message,
        });
        result.cloudflarePaused++;
        return;
      }

      if ((classified.kind === 'rate_limit' || classified.kind === 'transient') && nextAttempt <= this.maxRetries) {
        const delay = this.backoffScheduleMs[Math.min(nextAttempt - 1, this.backoffScheduleMs.length - 1)];
        await downloadRepo.updateJobStatus(this.db, job.id, 'rate_limited', {
          attemptCount: nextAttempt,
          nextRetryAt: this.now() + delay,
          lastError: classified.message,
        });
        result.rateLimited++;
        return;
      }

      await downloadRepo.updateJobStatus(this.db, job.id, 'failed', {
        attemptCount: nextAttempt,
        nextRetryAt: null,
        lastError: classified.message,
      });
      result.failed++;
    }
  }
}

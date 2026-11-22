import type { SqlExecutor, TrackerProvider } from '@/db/types';
import { trackerRepo } from '@/db/repositories/trackerRepo';
import { chapterRepo } from '@/db/repositories/chapterRepo';
import type { TrackerRemoteUpdate } from './types';

export function applyChapterOffset(chapterNumber: number, offset: number): number {
  return Math.max(0, Math.floor(chapterNumber + offset));
}

export interface SyncResolution {
  action: 'push' | 'conflict' | 'noop';
  localEffective: number;
  remoteChapter: number;
}

export function resolveSyncAction(
  localChapter: number,
  remoteChapter: number,
  chapterOffset = 0
): SyncResolution {
  const localEffective = applyChapterOffset(localChapter, chapterOffset);
  if (remoteChapter > localEffective) {
    return { action: 'conflict', localEffective, remoteChapter };
  }
  if (localEffective > remoteChapter) {
    return { action: 'push', localEffective, remoteChapter };
  }
  return { action: 'noop', localEffective, remoteChapter };
}

export interface SyncProgressResult {
  outcome: 'synced' | 'conflict' | 'noop' | 'queued_offline' | 'unlinked';
  remoteChapter?: number;
  localEffective?: number;
}

export async function pullRemoteProgressToLocal(
  db: SqlExecutor,
  novelId: number,
  provider: TrackerProvider,
  remoteChapter: number
): Promise<void> {
  const link = await trackerRepo.getLink(db, novelId, provider);
  if (!link) return;
  const localTarget = Math.max(0, remoteChapter - link.chapter_offset);
  await chapterRepo.markReadUpToChapter(db, novelId, localTarget);
  await trackerRepo.setPendingSync(db, link.id, false, remoteChapter, null);
}

export async function syncTrackerProgress(
  db: SqlExecutor,
  opts: {
    novelId: number;
    provider: TrackerProvider;
    localChapter: number;
    forceOverwrite?: boolean;
    fetchRemoteChapter?: () => Promise<number | null>;
    pushRemote: (update: TrackerRemoteUpdate) => Promise<void>;
  }
): Promise<SyncProgressResult> {
  const link = await trackerRepo.getLink(db, opts.novelId, opts.provider);
  if (!link) return { outcome: 'unlinked' };

  let remoteChapter = link.last_chapter_synced;
  if (opts.fetchRemoteChapter) {
    try {
      const liveRemote = await opts.fetchRemoteChapter();
      if (typeof liveRemote === 'number' && liveRemote >= 0) {
        remoteChapter = liveRemote;
      }
    } catch {
      // Offline or transient remote lookup failure falls back to cached last_chapter_synced
    }
  }

  const resolution = resolveSyncAction(opts.localChapter, remoteChapter, link.chapter_offset);
  if (resolution.action === 'conflict' && !opts.forceOverwrite) {
    await trackerRepo.setPendingSync(db, link.id, false, remoteChapter, null);
    return {
      outcome: 'conflict',
      remoteChapter: resolution.remoteChapter,
      localEffective: resolution.localEffective,
    };
  }
  if (resolution.action === 'noop' && !link.pending_sync) {
    return { outcome: 'noop', remoteChapter: resolution.remoteChapter, localEffective: resolution.localEffective };
  }

  try {
    await opts.pushRemote({
      remoteId: link.remote_id,
      chapter: resolution.localEffective,
      volume: link.volume_progress,
      status: link.status,
      score: link.score,
    });
    await trackerRepo.setPendingSync(db, link.id, false, resolution.localEffective, null);
    return { outcome: 'synced', localEffective: resolution.localEffective };
  } catch {
    await trackerRepo.setPendingSync(db, link.id, true, undefined, resolution.localEffective);
    return { outcome: 'queued_offline', localEffective: resolution.localEffective };
  }
}

export async function flushPendingTrackerSyncs(
  db: SqlExecutor,
  pushByProvider: (provider: 'anilist' | 'mal', update: TrackerRemoteUpdate) => Promise<void>
): Promise<{ synced: number; failed: number }> {
  const pending = await trackerRepo.listPendingSync(db);
  let synced = 0;
  let failed = 0;

  for (const link of pending) {
    if (link.provider !== 'anilist' && link.provider !== 'mal') continue;
    const chapterToPush = link.pending_chapter ?? link.last_chapter_synced;
    try {
      await pushByProvider(link.provider, {
        remoteId: link.remote_id,
        chapter: chapterToPush,
        volume: link.volume_progress,
        status: link.status,
        score: link.score,
      });
      await trackerRepo.setPendingSync(db, link.id, false, chapterToPush, null);
      synced++;
    } catch {
      failed++;
    }
  }

  return { synced, failed };
}

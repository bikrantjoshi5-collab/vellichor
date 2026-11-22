import type { SqlExecutor, TrackerProvider } from '@/db/types';
import { trackerRepo } from '@/db/repositories/trackerRepo';
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

export async function syncTrackerProgress(
  db: SqlExecutor,
  opts: {
    novelId: number;
    provider: TrackerProvider;
    localChapter: number;
    forceOverwrite?: boolean;
    pushRemote: (update: TrackerRemoteUpdate) => Promise<void>;
  }
): Promise<SyncProgressResult> {
  const link = await trackerRepo.getLink(db, opts.novelId, opts.provider);
  if (!link) return { outcome: 'unlinked' };

  const resolution = resolveSyncAction(opts.localChapter, link.last_chapter_synced, link.chapter_offset);
  if (resolution.action === 'conflict' && !opts.forceOverwrite) {
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
    await trackerRepo.setPendingSync(db, link.id, false, resolution.localEffective);
    return { outcome: 'synced', localEffective: resolution.localEffective };
  } catch {
    await trackerRepo.setPendingSync(db, link.id, true);
    return { outcome: 'queued_offline', localEffective: resolution.localEffective };
  }
}

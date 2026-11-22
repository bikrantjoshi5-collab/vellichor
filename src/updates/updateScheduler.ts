import type { SqlExecutor } from '@/db/types';
import { libraryRepo } from '@/db/repositories/libraryRepo';
import { chapterRepo } from '@/db/repositories/chapterRepo';
import type { PluginInstance } from '@/plugins/types';

export const WEEKLY_UPDATE_INTERVAL_SECONDS = 7 * 24 * 60 * 60;
export const WEEKLY_UPDATE_TASK_NAME = 'vellichor-weekly-chapter-updates';
export const UPDATE_NOTIFICATION_CHANNEL = 'vellichor-updates';

export type UpdateCadence = 'weekly' | 'daily' | 'off';

export interface LibraryUpdateReport {
  novelsChecked: number;
  novelsUpdated: number;
  newChaptersTotal: number;
  errors: string[];
  summaryText: string;
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function checkLibraryUpdates(deps: {
  db: SqlExecutor;
  getPlugin: (pluginId: string) => Promise<PluginInstance | null>;
  now?: () => number;
  delayMs?: number;
}): Promise<LibraryUpdateReport> {
  const now = deps.now ?? (() => Date.now());
  const delayMs = deps.delayMs ?? 500;
  const novels = await libraryRepo.listLibraryNovels(deps.db);
  const activeNovels = novels.filter((n) => n.reading_status !== 'dropped');

  let novelsChecked = 0;
  let novelsUpdated = 0;
  let newChaptersTotal = 0;
  const errors: string[] = [];

  for (const novel of activeNovels) {
    try {
      const plugin = await deps.getPlugin(novel.plugin_id);
      if (!plugin) continue;

      const parsed = await plugin.parseNovel(novel.path);
      novelsChecked++;

      const discoveredAt = now();
      const { inserted } = await chapterRepo.upsertChapters(
        deps.db,
        novel.id,
        parsed.chapters.map((c, idx) => ({
          path: c.path,
          name: c.name,
          chapterNumber: c.chapterNumber ?? idx + 1,
          releaseDate: c.releaseTime ?? null,
          discoveredAt,
        }))
      );

      if (inserted > 0) {
        novelsUpdated++;
        newChaptersTotal += inserted;
      }

      if (delayMs > 0) await sleep(delayMs);
    } catch (err) {
      errors.push(`${novel.title}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const summaryText =
    newChaptersTotal > 0
      ? `${newChaptersTotal} new ${newChaptersTotal === 1 ? 'chapter' : 'chapters'} across ${novelsUpdated} ${novelsUpdated === 1 ? 'novel' : 'novels'}`
      : 'All library novels are up to date';

  return {
    novelsChecked,
    novelsUpdated,
    newChaptersTotal,
    errors,
    summaryText,
  };
}

export async function configureUpdateNotifications(): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Notifications = require('expo-notifications');
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });
    await Notifications.setNotificationChannelAsync(UPDATE_NOTIFICATION_CHANNEL, {
      name: 'Chapter Updates',
      importance: Notifications.AndroidImportance?.DEFAULT ?? 3,
    });
    await Notifications.requestPermissionsAsync();
  } catch {
    // Ignored in Node/Jest environment.
  }
}

export async function registerWeeklyUpdateTask(cadence: UpdateCadence = 'weekly'): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const BackgroundTask = require('expo-background-task');
    // Unregister first so cadence changes (weekly <-> daily) actually update the Android WorkManager interval.
    await BackgroundTask.unregisterTaskAsync(WEEKLY_UPDATE_TASK_NAME).catch(() => {});
    if (cadence === 'off') return;

    const minimumIntervalMinutes = cadence === 'daily' ? 24 * 60 : 7 * 24 * 60;
    await BackgroundTask.registerTaskAsync(WEEKLY_UPDATE_TASK_NAME, {
      minimumInterval: minimumIntervalMinutes,
    });
  } catch {
    // Background task API unavailable in Jest or Expo Go; gracefully ignored.
  }
}

export async function sendUpdateSummaryNotification(report: LibraryUpdateReport): Promise<void> {
  if (report.newChaptersTotal <= 0) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Notifications = require('expo-notifications');
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Vellichor · New Chapters',
        body: report.summaryText,
        channelId: UPDATE_NOTIFICATION_CHANNEL,
      },
      trigger: null,
    });
  } catch {
    // Notifications unavailable in test environment.
  }
}

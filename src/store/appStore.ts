import { create } from 'zustand';
import type {
  ChapterUpdateRow,
  DownloadJobRow,
  NovelWithStats,
  PluginRow,
  ReadingStatus,
  RepoRow,
  ShelfRow,
  SqlExecutor,
} from '@/db/types';
import { getSetting, openAppDatabase, setSetting } from '@/db/database';
import { libraryRepo } from '@/db/repositories/libraryRepo';
import { chapterRepo } from '@/db/repositories/chapterRepo';
import { pluginRepo } from '@/db/repositories/pluginRepo';
import { downloadRepo } from '@/db/repositories/downloadRepo';
import { installOrUpdatePlugin, syncAllRepos } from '@/plugins/repoSync';
import { detectPluginUpdate } from '@/plugins/semver';
import { DownloadEngine } from '@/downloads/downloadEngine';
import { createExpoAssetStore, createExpoPluginBundleStore } from '@/downloads/storage';
import { getRuntimePlugin, invalidateLoadedPlugin } from '@/services/pluginLoader';
import {
  checkLibraryUpdates,
  registerWeeklyUpdateTask,
  sendUpdateSummaryNotification,
  type UpdateCadence,
} from '@/updates/updateScheduler';
import type { ReaderSurfaceId } from '@/theme';

export interface ReaderPrefs {
  surface: ReaderSurfaceId;
  fontSize: number;
  lineHeight: number;
  horizontalMargin: number;
  tapZonesEnabled: boolean;
  keepScreenAwake: boolean;
  ttsRate: number;
}

const DEFAULT_READER_PREFS: ReaderPrefs = {
  surface: 'moss',
  fontSize: 17,
  lineHeight: 1.75,
  horizontalMargin: 20,
  tapZonesEnabled: true,
  keepScreenAwake: false,
  ttsRate: 1.0,
};

interface AppStoreState {
  ready: boolean;
  db: SqlExecutor | null;
  engine: DownloadEngine | null;

  novels: NovelWithStats[];
  shelves: ShelfRow[];
  updates: ChapterUpdateRow[];
  repos: RepoRow[];
  plugins: PluginRow[];
  downloadJobs: DownloadJobRow[];

  activeFilter: ReadingStatus | 'all' | 'downloaded';
  activeShelfId: number | null;
  librarySearch: string;

  updateCadence: UpdateCadence;
  readerPrefs: ReaderPrefs;

  syncingRepos: boolean;
  checkingUpdates: boolean;
  lastBannerMessage: string | null;

  bootstrap: () => Promise<void>;
  refreshLibrary: () => Promise<void>;
  refreshUpdates: () => Promise<void>;
  refreshSources: () => Promise<void>;
  refreshQueue: () => Promise<void>;

  setFilter: (filter: ReadingStatus | 'all' | 'downloaded', shelfId?: number | null) => Promise<void>;
  setLibrarySearch: (q: string) => Promise<void>;
  createShelf: (name: string) => Promise<void>;
  deleteShelf: (id: number) => Promise<void>;

  addRepoUrl: (url: string, name?: string) => Promise<void>;
  removeRepo: (repoId: number) => Promise<void>;
  syncReposNow: () => Promise<void>;
  installPluginNow: (pluginId: string) => Promise<void>;
  updateAllOutdatedPlugins: () => Promise<void>;
  uninstallPlugin: (pluginId: string) => Promise<void>;

  checkUpdatesNow: () => Promise<void>;
  setUpdateCadence: (cadence: UpdateCadence) => Promise<void>;
  updateReaderPrefs: (patch: Partial<ReaderPrefs>) => Promise<void>;

  enqueueDownloads: (novelId: number, pluginId: string, chapterIds: number[]) => Promise<void>;
  pauseDownloads: () => Promise<void>;
  resumeDownloads: () => Promise<void>;
  retryFailedDownloads: () => Promise<void>;
  clearCloudflareSource: (pluginId: string) => Promise<void>;
  cancelNovelDownloads: (novelId: number) => Promise<void>;
  clearBanner: () => void;
}

const bundleStore = createExpoPluginBundleStore();

export const useAppStore = create<AppStoreState>((set, get) => ({
  ready: false,
  db: null,
  engine: null,

  novels: [],
  shelves: [],
  updates: [],
  repos: [],
  plugins: [],
  downloadJobs: [],

  activeFilter: 'all',
  activeShelfId: null,
  librarySearch: '',

  updateCadence: 'weekly',
  readerPrefs: DEFAULT_READER_PREFS,

  syncingRepos: false,
  checkingUpdates: false,
  lastBannerMessage: null,

  async bootstrap() {
    if (get().ready) return;
    const db = await openAppDatabase();

    const engine = new DownloadEngine({
      db,
      assetStore: createExpoAssetStore(),
      getPlugin: async (pluginId) => {
        const inst = await getRuntimePlugin(db, pluginId);
        if (!inst) throw new Error(`Plugin "${pluginId}" is not installed`);
        return inst;
      },
      onProgress: () => {
        void get().refreshQueue();
        void get().refreshLibrary();
      },
    });
    await engine.recoverInterrupted();

    const savedCadence = ((await getSetting(db, 'update_cadence')) as UpdateCadence | null) ?? 'weekly';
    const savedPrefsRaw = await getSetting(db, 'reader_prefs');
    let readerPrefs = DEFAULT_READER_PREFS;
    if (savedPrefsRaw) {
      try {
        readerPrefs = { ...DEFAULT_READER_PREFS, ...JSON.parse(savedPrefsRaw) };
      } catch {
        readerPrefs = DEFAULT_READER_PREFS;
      }
    }

    await registerWeeklyUpdateTask(savedCadence);

    set({ db, engine, updateCadence: savedCadence, readerPrefs, ready: true });
    await Promise.all([
      get().refreshLibrary(),
      get().refreshUpdates(),
      get().refreshSources(),
      get().refreshQueue(),
    ]);
  },

  async refreshLibrary() {
    const { db, activeFilter, activeShelfId, librarySearch } = get();
    if (!db) return;
    const [novels, shelves] = await Promise.all([
      libraryRepo.listLibraryNovels(db, {
        readingStatus: activeShelfId ? 'all' : activeFilter,
        shelfId: activeShelfId,
        search: librarySearch,
      }),
      libraryRepo.listShelves(db),
    ]);
    set({ novels, shelves });
  },

  async refreshUpdates() {
    const { db } = get();
    if (!db) return;
    const updates = await chapterRepo.listRecentUpdates(db, 100);
    set({ updates });
  },

  async refreshSources() {
    const { db } = get();
    if (!db) return;
    const [repos, plugins] = await Promise.all([pluginRepo.listRepos(db), pluginRepo.listPlugins(db)]);
    set({ repos, plugins });
  },

  async refreshQueue() {
    const { db } = get();
    if (!db) return;
    const downloadJobs = await downloadRepo.listJobs(db);
    set({ downloadJobs });
  },

  async setFilter(filter, shelfId = null) {
    set({ activeFilter: filter, activeShelfId: shelfId });
    await get().refreshLibrary();
  },

  async setLibrarySearch(q) {
    set({ librarySearch: q });
    await get().refreshLibrary();
  },

  async createShelf(name) {
    const { db } = get();
    if (!db || !name.trim()) return;
    await libraryRepo.createShelf(db, name.trim());
    await get().refreshLibrary();
  },

  async deleteShelf(id) {
    const { db, activeShelfId } = get();
    if (!db) return;
    await libraryRepo.deleteShelf(db, id);
    if (activeShelfId === id) set({ activeShelfId: null });
    await get().refreshLibrary();
  },

  async addRepoUrl(url, name) {
    const { db } = get();
    if (!db || !url.trim()) return;
    await pluginRepo.addRepo(db, url.trim(), name);
    await get().syncReposNow();
  },

  async removeRepo(repoId) {
    const { db } = get();
    if (!db) return;
    await pluginRepo.deleteRepo(db, repoId);
    await get().refreshSources();
  },

  async syncReposNow() {
    const { db } = get();
    if (!db) return;
    set({ syncingRepos: true });
    try {
      const res = await syncAllRepos(db);
      await get().refreshSources();
      const msg =
        res.errors.length > 0
          ? `Synced with warnings: ${res.errors[0]}`
          : `Checked ${res.reposChecked} repo(s) · ${res.pluginsIndexed} extensions indexed`;
      set({ lastBannerMessage: msg });
    } finally {
      set({ syncingRepos: false });
    }
  },

  async installPluginNow(pluginId) {
    const { db } = get();
    if (!db) return;
    await installOrUpdatePlugin(db, pluginId, bundleStore);
    invalidateLoadedPlugin(pluginId);
    await get().refreshSources();
    set({ lastBannerMessage: `Extension "${pluginId}" updated cleanly` });
  },

  async updateAllOutdatedPlugins() {
    const { db, plugins } = get();
    if (!db) return;
    const outdated = plugins.filter(
      (p) =>
        p.installed === 1 &&
        detectPluginUpdate({
          installedVersion: p.version,
          remoteVersion: p.remote_version,
          installedHash: p.bundle_hash,
          remoteHash: p.remote_hash,
        }).hasUpdate
    );
    let updated = 0;
    for (const p of outdated) {
      try {
        await installOrUpdatePlugin(db, p.id, bundleStore);
        invalidateLoadedPlugin(p.id);
        updated++;
      } catch {
        // Continue updating remaining extensions even if one fails
      }
    }
    await get().refreshSources();
    set({ lastBannerMessage: `Updated ${updated} extension(s)` });
  },

  async uninstallPlugin(pluginId) {
    const { db } = get();
    if (!db) return;
    const row = await pluginRepo.getPluginById(db, pluginId);
    if (row?.local_path) {
      await bundleStore.deleteBundle(row.local_path).catch(() => {});
    }
    await pluginRepo.markPluginUninstalled(db, pluginId);
    invalidateLoadedPlugin(pluginId);
    await get().refreshSources();
  },

  async checkUpdatesNow() {
    const { db } = get();
    if (!db) return;
    set({ checkingUpdates: true });
    try {
      const report = await checkLibraryUpdates({
        db,
        getPlugin: (id) => getRuntimePlugin(db, id),
      });
      await Promise.all([get().refreshLibrary(), get().refreshUpdates()]);
      await sendUpdateSummaryNotification(report);
      set({ lastBannerMessage: report.summaryText });
    } finally {
      set({ checkingUpdates: false });
    }
  },

  async setUpdateCadence(cadence) {
    const { db } = get();
    if (!db) return;
    await setSetting(db, 'update_cadence', cadence);
    await registerWeeklyUpdateTask(cadence);
    set({ updateCadence: cadence });
  },

  async updateReaderPrefs(patch) {
    const { db, readerPrefs } = get();
    const next = { ...readerPrefs, ...patch };
    set({ readerPrefs: next });
    if (db) {
      await setSetting(db, 'reader_prefs', JSON.stringify(next));
    }
  },

  async enqueueDownloads(novelId, pluginId, chapterIds) {
    const { engine } = get();
    if (!engine || chapterIds.length === 0) return;
    await engine.enqueueChapters(novelId, pluginId, chapterIds);
    void engine.startLoop();
  },

  async pauseDownloads() {
    await get().engine?.pauseAll();
  },

  async resumeDownloads() {
    const { engine } = get();
    if (!engine) return;
    await engine.resumeAll();
    void engine.startLoop();
  },

  async retryFailedDownloads() {
    const { engine } = get();
    if (!engine) return;
    await engine.retryFailed();
    void engine.startLoop();
  },

  async clearCloudflareSource(pluginId) {
    const { engine } = get();
    if (!engine) return;
    await engine.clearCloudflareForSource(pluginId);
    void engine.startLoop();
  },

  async cancelNovelDownloads(novelId) {
    await get().engine?.cancelNovelBatch(novelId);
  },

  clearBanner() {
    set({ lastBannerMessage: null });
  },
}));

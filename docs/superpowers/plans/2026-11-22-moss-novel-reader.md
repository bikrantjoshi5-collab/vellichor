# Midnight Moss — Personal Android Novel Reader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build **Midnight Moss**, a personal sideloadable Android novel reader (Expo + React Native + TypeScript) with LNReader-compatible GitHub extensions & reliable cache-busted updates, a resilient SQLite-backed bulk download queue (text + offline light novel illustrations), AniList/MAL/NovelUpdates tracking, weekly auto-updates, JSON backup + LNReader `.zip` import, and an OFF-by-default docked Voice Read-Aloud (TTS) reader.

**Architecture:** Modular Expo Router TypeScript app with a single Midnight Moss design-token layer (`src/theme/`), SQLite persistence (`expo-sqlite`) + filesystem storage for parsed chapter blocks and cached illustrations, a sandboxed CommonJS plugin runtime shimming LNReader v3 modules (`cheerio`, `htmlparser2`, `@libs/fetch`, `@libs/storage`), and pure-TypeScript core engines fully covered by Jest unit/integration tests.

**Tech Stack:** Expo (React Native, TypeScript, Expo Router), `expo-sqlite`, `expo-file-system`, `expo-speech`, `expo-keep-awake`, `expo-haptics`, `expo-image`, `expo-auth-session`, `expo-secure-store`, `expo-document-picker`, `expo-sharing`, `expo-notifications`, `expo-background-task`, `react-native-reanimated`, `react-native-gesture-handler`, `react-native-webview`, `@shopify/flash-list`, `lucide-react-native`, `zustand`, `cheerio`, `htmlparser2`, `dayjs`, `jszip`, `jest` + `ts-jest`.

**Spec:** `/home/bikrant/.gemini/antigravity/scratch/moss-reader/docs/superpowers/specs/2026-11-22-moss-novel-reader-design.md`

## Global Constraints

- Android-only personal APK (`minSdk 26`, sideloaded; zero bundled scraping sources).
- Exact **Midnight Moss** tokens: `#0F1715` ground, `#172320` surface, `#20312C` elevated surface, `#EAE6DC` primary text, `#93A79E` muted text, `#E08E6D` terracotta accent (`#18100D` foreground), `#7DC4A0` lichen mint good/sync, `#E9B44C` ochre warn, `rgba(234, 230, 220, 0.10)` hairline border.
- Bundled fonts: `Lora` (display + novel prose), `DM Sans` (UI controls), `IBM Plex Mono` (chapter counters, download speed, semver diffs).
- Zero hardcoded hex colors outside `src/theme/`; zero emoji used as icons (`lucide-react-native` 1.75px stroke only); tab bar uses `animation: 'none'`.
- Voice Read-Aloud (TTS) is strictly **OFF by default** and never floats over prose; when toggled ON in Reader Settings, it mounts as a docked bottom bar shrinking the scroll viewport cleanly.
- Reading status (`reading_status`) is strictly separate from many-to-many custom `shelves` (`shelves` + `novel_shelves`).
- Downloaded chapter HTML/blocks and offline light novel illustrations are stored on disk under per-chapter directories, never as SQLite blobs.

## Review Focus

1. **Silent upstream plugin fix without version bump:** A GitHub repo updates a plugin `.js` file while keeping `version: "2.4.1"` unchanged — `detectPluginUpdate` must flag an update when `remoteHash !== bundleHash` as well as when semver increases.
2. **Bulk queue failure isolation (HTTP 429 & Cloudflare 403):** One source hitting `429` (backoff retry) or `403` Cloudflare challenge (paused awaiting WebView clearance) must never block jobs queued for other sources, and resuming after app restart must restore `running` jobs back to `pending`.
3. **Broken illustration inside an otherwise valid chapter:** If one `<img>` in a light novel chapter fails to download (404/timeout), the chapter text and remaining illustrations must still save cleanly as downloaded with a recorded warning rather than marking the chapter failed.
4. **Tracker sync conflict & LN offset safety:** When remote AniList/MAL chapter progress exceeds local progress, `resolveSyncAction` must return a `conflict` prompt decision rather than silently overwriting local read history, and `chapter_offset` must shift synced chapter numbers accurately.
5. **Malformed or partial LNReader `.zip` backups:** Importing an LNReader `.zip` missing optional files (e.g., no `Category.json` or duplicate novels) must parse gracefully without throwing or duplicating existing library entries.

---

### Task 1: Project Scaffold, Git Init, Midnight Moss Theme & Shared Primitives

**Files:**
- Create: `package.json`, `app.json`, `tsconfig.json`, `jest.config.js`, `.gitignore`
- Create: `src/theme/colors.ts`, `src/theme/spacing.ts`, `src/theme/typography.ts`, `src/theme/radius.ts`, `src/theme/motion.ts`, `src/theme/index.ts`
- Create: `src/components/ThemedText.tsx`, `src/components/Button.tsx`, `src/components/Chip.tsx`, `src/components/ProgressBar.tsx`, `src/components/EmptyState.tsx`, `src/components/NovelCover.tsx`
- Test: `tests/theme.test.ts`

**Interfaces:**
- Produces: `mossColors`, `readerSurfaces`, `spacing`, `radius`, `motion`, `typography`, `fontFamilies` from `src/theme/index.ts`; shared UI primitives from `src/components/*`.

- [ ] **Step 1:** Initialize `/home/bikrant/.gemini/antigravity/scratch/moss-reader` with Git, Expo TypeScript `package.json`, `app.json` (Android package `com.personal.mossreader`, plugins for `expo-router`, `expo-sqlite`, `expo-font`, `expo-notifications`, `expo-secure-store`), `tsconfig.json`, `jest.config.js`, and install dependencies.
- [ ] **Step 2:** Write failing test `tests/theme.test.ts` asserting exact Midnight Moss hex palette tokens, 3 reader surfaces (`moss`, `paper`, `oled`), spacing 4pt grid, and Lora/DM Sans/IBM Plex Mono typography scale.
- [ ] **Step 3:** Run `npx jest tests/theme.test.ts` — verify FAIL.
- [ ] **Step 4:** Implement `src/theme/*` and reusable primitives in `src/components/*` following `expo-design-system` and `expo-animation` (pressed scale `0.97`, zero hardcoded colors outside `src/theme/`).
- [ ] **Step 5:** Run `npx jest tests/theme.test.ts` — verify PASS, commit.

---

### Task 2: SQLite Schema, Database Adapter & Core Repositories

**Files:**
- Create: `src/db/types.ts`, `src/db/schema.ts`, `src/db/database.ts`
- Create: `src/db/repositories/libraryRepo.ts`, `src/db/repositories/chapterRepo.ts`, `src/db/repositories/pluginRepo.ts`, `src/db/repositories/downloadRepo.ts`, `src/db/repositories/trackerRepo.ts`, `src/db/repositories/historyRepo.ts`
- Test: `tests/db.test.ts`

**Interfaces:**
- Produces: `SqlExecutor` interface (implemented by `expo-sqlite` at runtime and a real SQLite/in-memory executor in tests), `initDatabase(db)`, and typed repository modules for novels, shelves, chapters, plugins, repos, download jobs, tracker links, reading history, plugin storage, and settings.

- [ ] **Step 1:** Write failing test `tests/db.test.ts` verifying all 11 tables initialize cleanly, `reading_status` updates independently of many-to-many `shelves` (`novel_shelves`), `chapters.discovered_at` drives chronological Updates queries, and `resetInterruptedJobs()` recovers `running` jobs to `pending`.
- [ ] **Step 2:** Run `npx jest tests/db.test.ts` — verify FAIL.
- [ ] **Step 3:** Implement `src/db/types.ts`, `src/db/schema.ts`, `src/db/database.ts`, and all 6 repository files.
- [ ] **Step 4:** Run `npx jest tests/db.test.ts` — verify PASS, commit.

---

### Task 3: LNReader-Compatible GitHub Extension Manager & Sandboxed Plugin Runtime

**Files:**
- Create: `src/plugins/types.ts`, `src/plugins/semver.ts`, `src/plugins/repoSync.ts`, `src/plugins/shims.ts`, `src/plugins/runtime.ts`
- Test: `tests/plugins.test.ts`

**Interfaces:**
- Consumes: `pluginRepo` (`src/db/repositories/pluginRepo.ts`)
- Produces: `compareSemver(a, b)`, `detectPluginUpdate(installed, remote)`, `fetchRepoManifest(repoUrl, opts)`, `resolveRepoAssetUrl(repoUrl, relativePath)`, `loadPluginFromCode(code, context)`, `PluginInstance` adapter (`popularNovels`, `searchNovels`, `parseNovel`, `parseChapter`).

- [ ] **Step 1:** Write failing test `tests/plugins.test.ts` covering:
  - Semver upgrade (`2.4.1 -> 2.5.0`) AND same-version SHA-256 hash change detection (Review Focus #1).
  - Cache-busting request headers (`Cache-Control: no-cache`) and `?t=` timestamp URL appending.
  - Executing a realistic LNReader v3 CommonJS plugin fixture using `cheerio`, `@libs/fetch`, and `@libs/storage` to parse popular novels, novel details + chapters, and chapter HTML.
- [ ] **Step 2:** Run `npx jest tests/plugins.test.ts` — verify FAIL.
- [ ] **Step 3:** Implement `semver.ts`, `repoSync.ts`, `shims.ts`, and `runtime.ts`.
- [ ] **Step 4:** Run `npx jest tests/plugins.test.ts` — verify PASS, commit.

---

### Task 4: Chapter Block Parser & Resilient Bulk Download Engine (Text + Offline Illustrations)

**Files:**
- Create: `src/reader/chapterParser.ts`, `src/downloads/downloadEngine.ts`, `src/downloads/storage.ts`
- Test: `tests/downloads.test.ts`

**Interfaces:**
- Consumes: `downloadRepo`, `chapterRepo`, `PluginInstance`
- Produces: `parseChapterHtml(html, baseUrl) -> ChapterBlock[]`, `DownloadEngine` class (`enqueueChapters`, `pauseAll`, `resumeAll`, `retryFailed`, `clearCloudflareForSource`, `deleteChapterAssets`, `processNextTick`).

- [ ] **Step 1:** Write failing test `tests/downloads.test.ts` covering:
  - HTML parsing into clean `paragraph`, `heading`, `blockquote`, `divider`, and `image` blocks while stripping `<script>`/`<style>`.
  - Per-source concurrency (`max 1`) + polite delay + global cap (`max 2`).
  - HTTP `429` exponential backoff (`3s -> 10s -> 30s`, max 3 attempts) without stalling other sources (Review Focus #2).
  - Cloudflare `403` isolating only the challenged source into `cf_required` state while other sources finish (Review Focus #2).
  - Two-phase download caching offline light novel illustrations locally and rewriting `image` block URIs; one broken image URL logs a warning without failing chapter text (Review Focus #3).
  - Deleting a downloaded chapter removes both JSON content and illustration directory.
- [ ] **Step 2:** Run `npx jest tests/downloads.test.ts` — verify FAIL.
- [ ] **Step 3:** Implement `chapterParser.ts`, `storage.ts`, and `downloadEngine.ts`.
- [ ] **Step 4:** Run `npx jest tests/downloads.test.ts` — verify PASS, commit.

---

### Task 5: Tracking Engine (AniList, MyAnimeList, NovelUpdates) & Backup / LNReader `.zip` Importer

**Files:**
- Create: `src/trackers/types.ts`, `src/trackers/anilist.ts`, `src/trackers/mal.ts`, `src/trackers/syncService.ts`
- Create: `src/backup/mossBackup.ts`, `src/backup/lnreaderImport.ts`
- Test: `tests/trackersAndBackup.test.ts`

**Interfaces:**
- Consumes: `libraryRepo`, `chapterRepo`, `trackerRepo`, `pluginRepo`
- Produces: `AniListClient`, `MalClient`, `resolveSyncAction(localCh, remoteCh, offset)`, `applyChapterOffset(chapterNum, offset)`, `exportMossBackup(db)`, `importMossBackup(db, json)`, `previewLnReaderZip(zipBytes)`, `importLnReaderZip(db, zipBytes)`.

- [ ] **Step 1:** Write failing test `tests/trackersAndBackup.test.ts` covering:
  - Conflict detection when remote chapter > local chapter and accurate `chapter_offset` + `volume_progress` sync payload (Review Focus #4).
  - Offline sync queue marking `pending_sync = 1` on network failure and flushing on reconnect.
  - Midnight Moss JSON backup export → wipe → import round-trip preserving shelves, `reading_status`, `scroll_paragraph_idx`, tracker links, and repo URLs.
  - LNReader `.zip` backup parsing (both full archive and partial archive missing `Category.json` with duplicate novels — Review Focus #5).
- [ ] **Step 2:** Run `npx jest tests/trackersAndBackup.test.ts` — verify FAIL.
- [ ] **Step 3:** Implement `anilist.ts`, `mal.ts`, `syncService.ts`, `mossBackup.ts`, and `lnreaderImport.ts`.
- [ ] **Step 4:** Run `npx jest tests/trackersAndBackup.test.ts` — verify PASS, commit.

---

### Task 6: Docked Voice (TTS) Controller & Weekly Background Update Scheduler

**Files:**
- Create: `src/reader/ttsController.ts`, `src/updates/updateScheduler.ts`
- Test: `tests/ttsAndUpdates.test.ts`

**Interfaces:**
- Consumes: `ChapterBlock`, `libraryRepo`, `chapterRepo`, `PluginInstance`
- Produces: `TtsController` (strictly `enabled: false` by default, `setEnabled`, `play`, `pause`, `nextParagraph`, `prevParagraph`, `setRate`, `setVoice`, `onChapterComplete`), `checkLibraryUpdates(deps)`, `UPDATE_CADENCE_SECONDS` (default 7 days = `604800`), `registerWeeklyUpdateTask()`.

- [ ] **Step 1:** Write failing test `tests/ttsAndUpdates.test.ts` verifying:
  - `TtsController` starts disabled (`enabled === false`), speaks only text blocks (`paragraph`/`heading`/`blockquote`, skipping `image`/`divider`), advances paragraphs sequentially, triggers `onChapterComplete` at end of chapter, and cleanly stops speech immediately when toggled OFF.
  - `checkLibraryUpdates` discovers only new chapters (setting `discovered_at`), skips already-stored chapters, respects per-source throttling, and formats a concise summary notification string.
- [ ] **Step 2:** Run `npx jest tests/ttsAndUpdates.test.ts` — verify FAIL.
- [ ] **Step 3:** Implement `ttsController.ts` and `updateScheduler.ts`.
- [ ] **Step 4:** Run `npx jest tests/ttsAndUpdates.test.ts` — verify PASS, commit.

---

### Task 7: Midnight Moss Mobile UI — Navigation, All Screens, Reader + Docked TTS + Illustration Lightbox

**Files:**
- Create: `src/store/appStore.ts`
- Create: `app/_layout.tsx`, `app/(tabs)/_layout.tsx`, `app/(tabs)/index.tsx`, `app/(tabs)/updates.tsx`, `app/(tabs)/sources.tsx`, `app/(tabs)/more.tsx`
- Create: `app/novel/[id].tsx`, `app/reader/[chapterId].tsx`, `app/queue.tsx`, `app/source/[pluginId].tsx`, `app/webview.tsx`
- Create: `src/components/ReaderSettingsSheet.tsx`, `src/components/TtsDockedBar.tsx`, `src/components/IllustrationLightbox.tsx`, `src/components/TrackerModalSheet.tsx`

**Interfaces:**
- Consumes: `src/theme`, `src/components/*`, `src/db/repositories/*`, `src/plugins/*`, `src/downloads/*`, `src/trackers/*`, `src/backup/*`, `src/reader/*`, `src/updates/*`.

- [ ] **Step 1:** Build `src/store/appStore.ts` (Zustand reactive store bridging SQLite, DownloadEngine progress, active TTS state, and repo update counts).
- [ ] **Step 2:** Build root layout (`app/_layout.tsx`) loading `Lora`, `DM Sans`, and `IBM Plex Mono`, initializing SQLite + recovering interrupted download jobs, registering weekly background update check, and wrapping `GestureHandlerRootView` + `SafeAreaProvider`.
- [ ] **Step 3:** Build 4-tab layout (`app/(tabs)/_layout.tsx`, `animation: 'none'`) and all 4 primary tabs (`Library`, `Updates`, `Sources`, `More`) strictly using Midnight Moss tokens and zero hardcoded hex colors.
- [ ] **Step 4:** Build `Novel Detail`, `Source Browse`, `Download Queue`, `WebView` (Cloudflare cookie clearer + NovelUpdates "Link This Series"), and `Reader` (distraction-free vertical block renderer, tap-zone viewport scroll option, pinch-to-zoom `IllustrationLightbox`, `ReaderSettingsSheet` with OFF-by-default Voice toggle, and docked `TtsDockedBar`).
- [ ] **Step 5:** Run `npx tsc --noEmit` and `npx jest` — verify zero TypeScript errors and all tests PASS, commit.

---

### Task 8: Quality Audit, Maestro E2E Flows, GitHub Actions APK Workflow & Final Review

**Files:**
- Create: `.maestro/smoke-test.yaml`, `.maestro/reader-tts.yaml`, `.maestro/sources-update.yaml`, `.maestro/README.md`
- Create: `.github/workflows/build-android.yml`, `README.md`

- [ ] **Step 1:** Create Maestro E2E flows following `maestro-mobile-testing` (`testID` selectors matching screens built in Task 7).
- [ ] **Step 2:** Create GitHub Actions workflow `.github/workflows/build-android.yml` (JDK 17 + Node + Expo prebuild + Gradle `assembleRelease` uploading downloadable APK artifact) and concise `README.md` explaining local ADB install & GitHub repo push.
- [ ] **Step 3:** Run full verification suite:
  - `npx tsc --noEmit`
  - `npx jest --verbose`
  - Design-system drift grep check (confirm zero hardcoded hex colors outside `src/theme/` and zero emoji icons in `app/` and `src/components/`).
- [ ] **Step 4:** Dispatch a fresh whole-branch code reviewer subagent (`research` / `self`), address any Critical/Important findings via TDD, and commit cleanly.

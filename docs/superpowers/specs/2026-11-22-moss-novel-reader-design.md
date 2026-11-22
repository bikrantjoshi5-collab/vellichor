# Midnight Moss — Personal Android Novel Reader Design Document

**Date:** 2026-11-22  
**Status:** Ready for User Approval (Post Builder-Check Revision)  
**Target Platform:** Personal Android APK (sideloaded via ADB or direct APK install; private GitHub repository for source & APK recovery; no Play Store release)

---

## 1. Intent & The Why

The user reads manga/manhwa in Mihon and wants a **private, personal Android novel reader** for light novels and webnovels that replaces LNReader cleanly as they begin their novel-reading journey.

LNReader fails the user in four specific ways:
1. **Bulk downloads break and stall:** Queuing many chapters at once freezes in an error state with poor recovery and no polite rate-limiting.
2. **GitHub extension repos are flaky and miss updates:** Importing community repos is error-prone, and extensions often lack a working update button even when upstream sites/plugins have pushed a newer version.
3. **Reader Voice (TTS) intrudes on the page:** LNReader's voice controls hover directly over the text, obstructing reading.
4. **UI feels rough and generic:** The user wants a deliberate, handcrafted interface of their own choosing—**Midnight Moss**—not a Mihon copy and not generic AI-slop UI.

Success means an Android app the user reaches for every night: Midnight Moss visual craft, effortless LNReader-compatible GitHub extension management with reliable one-tap updates, bulk chapter downloads (including offline light novel illustrations) that never wedge, accurate tracking (AniList, MyAnimeList, NovelUpdates, plus local history & weekly auto-updates), reliable backup/restore (plus LNReader `.zip` import), a GitHub repo for safe recovery, and a silent-by-default voice reader that stays completely invisible until explicitly switched on in settings.

---

## 2. Goals, Non-Goals, and Anti-Goals

### Goals
- **Rock-solid bulk downloads (text + offline illustrations):** Queue dozens or hundreds of chapters with per-source rate limiting, exponential backoff on 429/5xx, persistent SQLite queue state across restarts, local caching of embedded light novel `<img>` illustrations, and clean Pause / Resume / Retry Failed / Cancel controls.
- **Reliable LNReader-compatible GitHub extension ecosystem:** Import standard LNReader GitHub plugin repos (`plugins.min.json`), bust stale GitHub CDN caches when checking for updates, compare semver + bundle hash accurately, and expose working one-tap **Update** and **Update All** actions.
- **Handcrafted Midnight Moss UI:** Full implementation of the user-approved **Concept 4: Midnight Moss (Botanical Dusk Study · Terracotta)** design system across every screen.
- **Non-intrusive Voice Read-Aloud (TTS):** Built-in Android TTS strictly **OFF by default**, toggled from Reader Settings, and docked cleanly at the bottom edge below the prose (never floating over text) when enabled, with auto-advance to the next chapter.
- **Strong Tracking, Weekly Auto-Updates & Backup:**
  - Two-way OAuth sync with **AniList** and **MyAnimeList**, plus **NovelUpdates** WebView lookup/linking.
  - Automatic **weekly** chapter update checks with an Android notification and chronological **Updates** feed (plus manual pull-to-refresh anytime).
  - Full Midnight Moss portable JSON backup & restore **plus** an **LNReader `.zip` backup importer**.
  - Version-controlled in a **GitHub repository** so the user can re-download source or built APKs anytime if they ever lose the device.

### Non-Goals
- Public Play Store / App Store distribution, user accounts, hosted cloud sync backends, or monetization.
- iOS support (Android-only personal APK).
- Shipping bundled copyrighted novel sources (all web sources come from user-added LNReader-compatible GitHub repos).
- Social feeds, comments, or built-in EPUB/PDF authoring.

### Anti-Goals (Failure even if technically working)
- **Floating/hovering overlays over reader text:** No floating TTS bubble, no sticky FABs overlapping paragraphs while reading.
- **Silent stuck downloads:** A failed chapter or missing illustration must never freeze the entire queue or require clearing app data to recover.
- **Generic AI-slop UI:** No neon purple/blue gradients, no system-default generic cards, no emoji standing in for icons, no cluttered stats widgets.
- **Hidden or broken extension updates:** If a repo's `plugins.min.json` has a newer version or changed bundle hash, the update button must surface immediately upon refresh.

---

## 3. Constraints

- **Personal Android Device:** Built for sideloading (`minSdk 26`, target Android 14/15/16).
- **Local Dev Environment:** Linux host with Node `v26.11.1`, npm `12.2.1`, Android SDK (`platforms 35–37`, `build-tools 36–37`), and `adb`. Note: host currently has OpenJDK 27; Android Gradle builds require JDK 17 or 21 installed locally (or Expo EAS cloud APK build as fallback).
- **Offline-First Reading:** Downloaded chapters—including cached light novel illustrations—must render instantaneously with zero network access.
- **Source Hygiene:** App ships with zero pre-installed scraping sources; the user imports their chosen LNReader-compatible GitHub repo URLs in-app.
- **Disaster Recovery:** Project is initialized as a clean Git repository ready to push to the user's GitHub account (with GitHub Actions workflow option or release instructions so APKs can always be rebuilt/re-downloaded).

---

## 4. Approaches Considered

| Approach | Summary | Tradeoffs |
|---|---|---|
| **1. Fresh Expo + React Native (TypeScript) *(Picked)*** | Clean Expo prebuild Android app with Expo Router, `expo-sqlite`, Reanimated, native Android services where needed, and direct JS execution of LNReader plugins via a clean shim layer. | Slightly larger APK (~35–55 MB) than pure Kotlin, and requires implementing the LNReader JS plugin shim cleanly once. Best JS runtime compatibility for LNReader plugins, fast iteration, and full alignment with installed Expo/UI/Maestro skills. |
| **2. Native Android (Kotlin + Jetpack Compose + QuickJS)** | Pure Kotlin app with Room, WorkManager, native `TextToSpeech`, and QuickJS solely to execute JS plugins. | Smallest APK (~15 MB), but bridging LNReader's JS plugins (`fetch`, `cheerio`/`htmlparser2`, cookies, Cloudflare WebView) across Kotlin ↔ QuickJS is fragile and high-maintenance. |
| **3. Fork LNReader & Rewrite UI / Queue / Updater** | Clone LNReader's open-source RN repo and replace its UI, download engine, and repo manager. | Instant plugin shim parity, but carries years of legacy state, old dependency debt, and tangled screens that slow down custom craft. |

**Decision:** User picked **Approach 1 (Fresh Expo + React Native)**.

---

## 5. Design Specification

### 5.1 Visual System — Midnight Moss (User-Pinned)
- **Palette Tokens:**
  - Ground (`bg`): `#0F1715` (Deep Pine-Slate)
  - Elevated Surface (`surface`): `#172320` (Moss)
  - Raised Card / Banner (`surfaceElevated`): `#20312C` (Deep Cedar)
  - Primary Ink (`fg`): `#EAE6DC` (Oat Cream — high contrast without pure-white OLED halation)
  - Secondary Ink (`muted`): `#93A79E` (Muted Sage)
  - Primary Accent (`accent`): `#E08E6D` (Warm Terracotta) with `#18100D` foreground
  - Positive / Sync / Downloaded (`good`): `#7DC4A0` (Lichen Mint)
  - Warning / Retry / Update Available (`warn`): `#E9B44C` (Warm Ochre)
  - Hairline Divider (`border`): `rgba(234, 230, 220, 0.10)`
- **Typography:**
  - Display & Novel Prose: **Lora** (`@expo-google-fonts/lora`)
  - UI Controls & Labels: **DM Sans** (`@expo-google-fonts/dm-sans`)
  - Tabular Counters & Versions: **IBM Plex Mono** (strictly for chapter counts, download speed, semver diffs)
- **Iconography & Craft Rules:**
  - Consistent 1.75px-stroke vector icons (`lucide-react-native`); zero emoji icons.
  - Card radius `14–16px`, cover radius `10px`, tactile press scale `0.97` on Reanimated UI thread, subtle haptics (`expo-haptics`).
  - *(Builder call)*: Midnight Moss is the signature default theme everywhere; inside **Reader Settings** only, offer two optional reading paper surfaces—**Warm Paper (`#F5F0E6` / `#1C1917`)** for bright daylight and **True OLED (`#0B0B0D` / `#EDE8DF`)**.

### 5.2 Navigation & Core Screens
Four bottom tabs — **`Library`**, **`Updates`**, **`Sources`**, **`More`** (with an always-accessible **Download Queue** badge/sheet reachable from `More` and from a live mini progress pill when downloads are actively running, keeping the tab bar clean at 4 items):

1. **Library Screen (Midnight Moss Signature Layout)**
   - Top **"Continue Reading" hero banner** (`#20312C` card with cover on right, progress bar, tracker pill, one-tap jump to exact paragraph).
   - Horizontal **filter chips** covering reading statuses (`All`, `Reading`, `Downloaded`, `Plan to Read`, `On Hold`, `Completed`, `Dropped`) plus user-created **custom shelves** (e.g., `Favorites`, `Xianxia`).
   - *(Builder call)*: Keep **`reading_status`** (1-to-1 mapped to AniList/MAL) strictly separate from many-to-many **`shelves`** (`shelves` + `novel_shelves` tables) so organizing novels into custom shelves never breaks tracker status syncing.
   - **2-column generous cover cards** with title, current chapter, terracotta unread count (`+18`), downloaded indicator, and slim lichen-mint progress bar.
   - Pull-to-refresh manually checks active library novels for new chapters on demand.

2. **Updates Screen (Weekly Auto-Updates + Manual Refresh)**
   - Chronological feed of newly discovered chapters grouped by date (`Today`, `This Week`, `Earlier`), tracked via `discovered_at` (separate from source `release_date`) so newly dropped chapters always appear cleanly at the top.
   - One-tap chapter read or quick-download button per item.
   - **Weekly Automated Background Check:** Scheduled once every 7 days (default, configurable to Daily / Weekly / Off in Settings; Wi-Fi-preferred, battery-not-low constraint) using Android WorkManager / `expo-background-task` to refresh library novels via installed plugins and post a single summary Android notification (e.g., *"14 new chapters across 3 novels"*).

3. **Novel Detail Screen**
   - Cover, title, author, reading status picker, custom shelf chips, expandable synopsis, **Tracker bar** (AniList / MAL / NovelUpdates bind & sync status), **Bulk Download menu** (Download Next 10 / 25 / 50 / Unread / Custom Range / All), and searchable/sortable chapter list showing read/downloaded/queued/failed state per chapter.

4. **Reader Screen + Non-Intrusive Voice (TTS) + Offline Illustrations**
   - *(Builder call)*: Native **structured paragraph-block & image-block vertical scroll renderer** (HTML parsed into clean paragraph, heading, divider, blockquote, and illustration blocks), with optional **tap-top/bottom-zone viewport scroll** (one screen down/up) rather than WebView horizontal pagination—guaranteeing silky performance, exact `scroll_paragraph_idx` memory, crisp inline illustration zoom, and rock-solid TTS paragraph highlighting.
   - **Offline Light Novel Illustrations:** Inline `<img>` blocks render locally cached illustration files (`documentDirectory/chapters/<novelId>/<chapterId>/img_<n>.<ext>`), falling back to online fetch if the chapter isn't downloaded. Tapping any illustration opens a pinch-to-zoom full-screen lightbox viewer.
   - Tapping the center toggles top header (back, novel/chapter title, settings sliders icon) and bottom chapter scrubber/progress bar; while reading, **zero controls float over the prose**.
   - **Reader Settings Bottom Sheet:**
     - **Voice Read-Aloud (TTS) Toggle:** Strictly **OFF by default**. When toggled ON, a compact **docked bottom audio bar** mounts *below* the scroll container (shrinking the viewport cleanly so it never overlaps text) with Play/Pause, Next/Prev Paragraph, Speed (`0.75x–2.0x`), Voice picker, and a quick `×` button to turn TTS back off. Highlights the currently spoken paragraph with a subtle terracotta tint, auto-scrolls it into view, and auto-advances cleanly into the next downloaded/online chapter when a chapter ends.
     - *(Builder call)*: Implement TTS via `expo-speech` + `expo-keep-awake` while actively playing (foreground docked listening, simple & crash-free, behind a clean `TtsController` interface so a native Kotlin `MediaSession` lock-screen service can be dropped in later without rewriting Reader UI).
     - Typography controls: Font size, line height, horizontal margins, reader surface (`Midnight Moss` / `Warm Paper` / `True OLED`), tap-zone scrolling toggle, keep screen awake toggle.
   - Automatically saves exact chapter + paragraph offset locally and queues tracker progress sync on chapter completion.

5. **Sources & GitHub Extensions Screen**
   - **Repositories Manager:** Add/remove raw GitHub `plugins.min.json` URLs (supports standard `lnreader-plugins` repo layout and custom user forks).
   - **Reliable Update Detection (Fixes LNReader bug):**
     - Fetches `plugins.min.json` with cache-busting headers (`Cache-Control: no-cache`, `?t=<timestamp>`) plus ETag/SHA comparison so GitHub's raw CDN never hides fresh commits.
     - Compares installed plugin `version` (semver) **and** bundle SHA-256 hash against the repo manifest—detecting both semver bumps (`2.4.1 → 2.5.0`) and silent upstream hotfixes.
     - Always shows a clear **Update** button per outdated extension, a top **Update All** button, and a manual **Force Re-fetch** action on every installed extension.
   - **Browse & Search:** Tap any installed extension to browse `popularNovels` (with filters), `searchNovels`, or run Global Search across all installed sources.

6. **Download Queue Screen (Fixes LNReader Bulk-Download Bug)**
   - **SQLite-Persisted Job Queue (`download_jobs` table):** Every queued chapter is an individual row with status `pending | running | completed | rate_limited | failed | paused`, `attempt_count`, `next_retry_at`, and `last_error`.
   - **Two-Phase Chapter + Illustration Download:**
     - Phase 1: Fetch and sanitize chapter HTML via plugin `parseChapter`.
     - Phase 2: Extract any `<img>` URLs, download each illustration using the plugin's cookies/User-Agent/`Referer` into the chapter's local asset directory, rewrite `src` to local `file://` URIs, and store safely on disk. A single broken image URL logs a soft warning without failing the chapter text download; deleting a chapter removes both its HTML and its image directory cleanly.
   - **Per-Source Rate Limiter & Concurrency Guard:**
     - Max `1` concurrent chapter download per source domain by default (configurable `1–3`), with configurable polite delay (`600ms–1200ms` jitter) so queuing 200+ chapters never triggers bans or hangs.
     - Global cap of `2` concurrent sources simultaneously.
   - **Graceful Recovery:**
     - `429 Too Many Requests`, `5xx`, or timeouts trigger exponential backoff (`3s → 10s → 30s`, up to 3 automatic retries) while other sources keep running.
     - Cloudflare `403` / interstitial responses pause that source cleanly with a one-tap **"Open in WebView to Clear Check"** action (sharing cookies with `fetchApi`).
     - Controls: **Pause / Resume Queue**, **Retry All Failed**, **Cancel Novel Batch**, and clear per-job error diagnostics.
   - **Android Foreground Service:** Keeps large download batches alive with a clean notification progress bar when backgrounded or screen-locked.

7. **Tracking, History, Backup & Migration (`More` Screen)**
   - **AniList & MyAnimeList (Two-Way Sync):**
     - *(Builder call)*: Because this is a private personal APK with no backend server, AniList uses OAuth2 Implicit Grant and MyAnimeList uses OAuth2 PKCE (`expo-auth-session` + `expo-secure-store`). OAuth `client_id` values can be supplied via `.env` at build time **or** entered/edited directly in an in-app **Tracker Setup** screen (with step-by-step redirect-URI instructions).
     - *(Builder call)*: On linking or sync conflict where remote chapter > local, prompt the user (**"Pull remote progress"** vs. **"Keep local"**) rather than silently overwriting. Store optional `volume_progress` and `chapter_offset` on `tracker_links` to handle light novels whose AniList/MAL volume/chapter numbering differs from webnovel chapters.
     - Offline sync queue retries automatically when connectivity returns.
   - **NovelUpdates Integration:**
     - *(Builder call)*: Embedded in-app **NovelUpdates WebView** where the user searches/browses normally (passing Cloudflare natively) and taps a docked **"Link This Series"** button that extracts the canonical URL, title, tags, and release status cleanly from the loaded page—zero brittle HTML scraping.
   - **Local Tracking & History:** Reading history timeline, per-novel reading time & stats, custom shelves manager.
   - **Backup, Restore & LNReader Migration:**
     - **Midnight Moss Backup / Restore (`.json`):** Export and import via Android Storage Access Framework containing library entries, `reading_status`, custom shelves, chapter read flags, `scroll_paragraph_idx`, tracker links, GitHub repo URLs, and reader preferences (excluding chapter blobs/images so backups stay tiny and portable).
     - **LNReader `.zip` Importer:** Parses standard LNReader backup archives (`Category.json`, `Novel.json`, `Chapter.json`, `Setting.json` / repo list), maps plugin IDs, novels, categories → custom shelves, and read chapter progress into Midnight Moss with a clear preview summary before importing.

---

## 5.3 LNReader Plugin Runtime Architecture

LNReader v3 plugins compiled into `.dist/<lang>/<id>.js` are CommonJS bundles expecting a known set of host modules:

- **Sandboxed Execution Loader:** Load downloaded plugin `.js` files from local storage via a controlled `Function('require', 'exports', 'module', code)` wrapper.
- **Host-Provided Module Registry (`require` shim):**
  - `cheerio`, `htmlparser2`, `dayjs`, `urlencode`
  - `@libs/fetch` (`fetchApi`, `fetchText`, `fetchProto` — backed by native `fetch` with shared Android WebView cookies, custom `User-Agent`, timeout, and Cloudflare WebView fallback)
  - `@libs/storage` (per-plugin persistent KV store backed by SQLite `plugin_storage`)
  - `@libs/novelStatus`, `@libs/filterInputs`, `@libs/isAbsoluteUrl`, `@libs/defaultCover`
- **Normalized Plugin Adapter:** Typed TypeScript wrapper over `popularNovels`, `searchNovels`, `parseNovel`, `parseChapter`, and optional `resolveUrl` / `filters` with timeouts and structured error reporting so one broken plugin never crashes the app.

---

## 5.4 Data Model (SQLite via `expo-sqlite`)

- `repos` (`id`, `url`, `name`, `etag`, `last_checked_at`)
- `plugins` (`id`, `repo_id`, `name`, `lang`, `site`, `version`, `remote_version`, `bundle_hash`, `remote_hash`, `icon_url`, `file_url`, `local_path`, `installed`, `enabled`, `updated_at`)
- `novels` (`id`, `plugin_id`, `path`, `title`, `author`, `cover_url`, `local_cover_path`, `summary`, `source_status`, `reading_status`, `in_library`, `last_read_at`, `created_at`)
- `shelves` (`id`, `name`, `sort_order`, `created_at`)
- `novel_shelves` (`novel_id`, `shelf_id`)
- `chapters` (`id`, `novel_id`, `path`, `name`, `chapter_number`, `release_date`, `discovered_at`, `is_read`, `read_progress_pct`, `scroll_paragraph_idx`, `is_downloaded`, `content_path`, `assets_dir`, `updated_at`)
- `download_jobs` (`id`, `chapter_id`, `novel_id`, `plugin_id`, `status`, `attempt_count`, `next_retry_at`, `last_error`, `created_at`)
- `tracker_links` (`id`, `novel_id`, `provider`, `remote_id`, `remote_title`, `remote_url`, `status`, `last_chapter_synced`, `volume_progress`, `chapter_offset`, `score`, `pending_sync`, `updated_at`)
- `reading_history` (`id`, `novel_id`, `chapter_id`, `read_at`, `duration_sec`)
- `plugin_storage` (`plugin_id`, `key`, `value`)
- `app_settings` (`key`, `value`)

Downloaded chapters live on disk at `documentDirectory/chapters/<novelId>/<chapterId>/content.json` (parsed paragraph/image blocks) + `img_<n>.<ext>` illustration assets, keeping SQLite lean and instantaneous even with 10,000+ chapters.

---

## 5.5 Verification, GitHub Repo & Release Plan

- **Unit & Integration Tests (Jest):** Semver + hash update detection, LNReader plugin shim execution against real HTML fixtures, download queue rate-limiting + retry/backoff + offline illustration caching, Midnight Moss JSON backup/restore round-trip, LNReader `.zip` backup import parsing, and AniList/MAL client sync logic.
- **UI Stress-Testing (`break-ui`):** Verify long light novel titles (120+ chars), missing covers, CJK/non-Latin titles, 0-item empty states, inline illustrations of extreme aspect ratios, and 2,000+ chapter lists.
- **Mobile E2E (`maestro-mobile-testing`):** Smoke flows on Android device/emulator covering library navigation, reader + off-by-default docked TTS toggle, offline illustration lightbox, extension update button, download pause/retry, and backup export/import.
- **GitHub Repository & APK Recovery:** Initialize Git repo inside `moss-reader`, include a clean `.gitignore` (keeping OAuth secrets out of commits), and set up a GitHub remote + optional GitHub Actions APK build workflow (or EAS/local release APK tagging) so the user can always re-download the app if needed.

---

## 6. What's Left to the Builder

- Choice of client state layer (e.g., Zustand + SQLite reactive hooks vs. TanStack Query).
- Exact Android foreground service & weekly background worker wiring (`expo-background-task` / WorkManager config plugin).
- Exact folder layout inside `/home/bikrant/.gemini/antigravity/scratch/moss-reader/` (following `expo-project-structure`).
- Setting up JDK 17/21 locally for Gradle APK builds vs. configuring Expo EAS build profile alongside GitHub Actions.

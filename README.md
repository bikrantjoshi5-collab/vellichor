# Vellichor

> *Vellichor* — the quiet, timeless stillness of a library filled with thousands of worlds waiting to be read.

A personal, sideloadable Android light novel & webnovel reader crafted in the **Midnight Moss** visual system (`#0F1715`, `#172320`, `#EAE6DC`, `#E08E6D`, `#7DC4A0` · `Lora` + `DM Sans` + `IBM Plex Mono`).

## Core Features
- **LNReader-Compatible GitHub Extensions:** Paste any raw `plugins.min.json` GitHub URL, browse curated recommended repos, or search GitHub live for repos. Includes real extension logos, `Installed` vs `Browse Repos` tabs, cache-busted manifest sync, and semver + bundle-hash **Update / Update All** detection.
- **Ordered Global Search & Continuous Cached Browsing:** Search across all installed sites strictly in order. Every site includes **Popular**, **Latest**, and **Filter** tabs with unlimited per-website filters (searchable filter sheet + active filter pills), continuous infinite scrolling, and persistent SQLite catalog + cover disk caching.
- **Library Labels & Exact Mid-Chapter Resume:** Organize your shelf with color-coded labels (long-press any novel card to tag instantly). Resumes reading or voice narration at the exact pixel, paragraph, and percentage where you left off.
- **HD Natural Voice Read-Aloud (TTS):** Strictly OFF by default so nothing floats over the prose. Automatically picks Android's HD neural voices (filtering out blurry legacy offline voices), supports custom reading speed (`0.75x–2.0x` with `±0.05x` fine-tuning) and voice tone, lets you pick any starting paragraph (long-press any paragraph or use the docked **Pick Paragraph** control), and auto-advances chapters.
- **Resilient Bulk Download Engine:** SQLite-persisted queue with per-source throttling, exponential backoff on HTTP 429/5xx, isolated Cloudflare WebView clearance, and two-phase **offline light novel illustration caching** with pinch-to-zoom lightbox.
- **Tracking, Weekly Updates & Backup:** Two-way OAuth sync for AniList and MyAnimeList (with chapter offset & conflict resolution), embedded NovelUpdates WebView linker, once-a-week automatic chapter checks, portable Vellichor `.json` backup/restore, and LNReader `.zip` backup import.

## Development & Verification
```bash
npm run typecheck    # TypeScript strict check
npm run lint:theme   # Verifies 0 hardcoded hex colors outside src/theme/
npm test             # Full Jest unit & SQLite integration test suite (33 tests)
```

## Installing on Your Android Phone
1. **Local APK Build (requires JDK 17 or 21 + Android SDK):**
   ```bash
   npx expo prebuild --platform android
   cd android && ./gradlew assembleRelease
   adb install -r app/build/outputs/apk/release/app-release.apk
   ```
2. **GitHub Actions Cloud APK Build:**
   Trigger **Actions → Build Android APK → Run workflow** to build and download a ready-to-install `vellichor-android-apk` artifact anytime.

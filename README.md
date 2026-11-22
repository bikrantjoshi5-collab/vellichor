# Vellichor

> *Vellichor* — the quiet, timeless stillness of a library filled with thousands of worlds waiting to be read.

A personal, sideloadable Android light novel & webnovel reader crafted in the **Midnight Moss** visual system (`#0F1715`, `#172320`, `#EAE6DC`, `#E08E6D`, `#7DC4A0` · `Lora` + `DM Sans` + `IBM Plex Mono`).

## Core Features
- **LNReader-Compatible GitHub Extensions:** Paste any raw `plugins.min.json` GitHub URL. Cache-busted manifest sync + semver & bundle-hash update detection guarantees working one-tap **Update** and **Update All** actions.
- **Resilient Bulk Download Engine:** SQLite-persisted queue with per-source throttling, exponential backoff on HTTP 429/5xx, isolated Cloudflare WebView clearance, and two-phase **offline light novel illustration caching** with pinch-to-zoom lightbox.
- **Non-Intrusive Voice Read-Aloud (TTS):** Strictly OFF by default so nothing floats over the prose. Toggle ON inside Reader Settings to mount a clean docked bottom bar with paragraph highlight, speed controls, and automatic next-chapter advance.
- **Tracking, Weekly Updates & Backup:** Two-way OAuth sync for AniList and MyAnimeList (with chapter offset & conflict prompt), embedded NovelUpdates WebView linker, once-a-week automatic chapter checks, portable Vellichor `.json` backup/restore, and LNReader `.zip` backup import.

## Development & Verification
```bash
npm run typecheck    # TypeScript strict check
npm run lint:theme   # Verifies 0 hardcoded hex colors outside src/theme/
npm test             # Full Jest unit & SQLite integration test suite
```

## Installing on Your Android Phone
1. **Local APK Build (requires JDK 17 or 21 + Android SDK):**
   ```bash
   npx expo prebuild --platform android
   cd android && ./gradlew assembleRelease
   adb install app/build/outputs/apk/release/app-release.apk
   ```
2. **GitHub Actions Cloud APK Build:**
   Push this repository to your personal GitHub repo, then trigger **Actions → Build Android APK → Run workflow** to download a ready-to-install `vellichor-android-apk` file anytime.

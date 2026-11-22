const { withAndroidManifest, withAppBuildGradle } = require('@expo/config-plugins');

const BLOCKED_PERMISSIONS = [
  'android.permission.SYSTEM_ALERT_WINDOW',
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
];

function ensureToolsNamespace(manifest) {
  if (!manifest.$) manifest.$ = {};
  if (!manifest.$['xmlns:tools']) {
    manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
  }
}

/**
 * Expo config plugin that applies Android release security hardening on every `expo prebuild`:
 * 1. Disables Android cloud/ADB backups (`allowBackup="false"`).
 * 2. Explicitly strips unneeded permissions (`SYSTEM_ALERT_WINDOW`, legacy storage) with `tools:node="remove"`.
 * 3. Restricts the `vellichor://` deep link intent-filter strictly to `vellichor://auth` (blocks `vellichor://webview?url=...`).
 * 4. Wires private release keystore signing (`signingConfigs.release`) via env/Gradle properties.
 */
function withSecurityHardening(config) {
  config = withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    ensureToolsNamespace(manifest);

    // 1. Strip unneeded permissions using tools:node="remove" so libraries cannot re-inject them
    const perms = Array.isArray(manifest['uses-permission']) ? manifest['uses-permission'] : [];
    const filtered = perms.filter(
      (p) => !BLOCKED_PERMISSIONS.includes(p?.$?.['android:name'])
    );
    for (const permName of BLOCKED_PERMISSIONS) {
      filtered.push({
        $: {
          'android:name': permName,
          'tools:node': 'remove',
        },
      });
    }
    manifest['uses-permission'] = filtered;

    // 2. Disable Android auto-backups so SQLite library, history, and plugins never leak to cloud/ADB backups
    const app = manifest.application?.[0];
    if (app?.$) {
      app.$['android:allowBackup'] = 'false';
      delete app.$['android:fullBackupContent'];
      delete app.$['android:dataExtractionRules'];
      const existingReplace = app.$['tools:replace']
        ? app.$['tools:replace'].split(',').map((s) => s.trim()).filter(Boolean)
        : [];
      if (!existingReplace.includes('android:allowBackup')) {
        existingReplace.push('android:allowBackup');
      }
      app.$['tools:replace'] = existingReplace.join(',');
    }

    // 3. Restrict `vellichor://` deep links strictly to `vellichor://auth` (OAuth callback only)
    const activities = app?.activity ?? [];
    for (const act of activities) {
      const filters = act['intent-filter'] ?? [];
      for (const flt of filters) {
        const dataList = flt.data ?? [];
        for (const d of dataList) {
          if (d?.$?.['android:scheme'] === 'vellichor') {
            d.$['android:host'] = 'auth';
          }
        }
      }
    }

    return cfg;
  });

  // 4. Configure real release keystore signing from env vars (never hardcode secrets in repo)
  config = withAppBuildGradle(config, (cfg) => {
    let contents = cfg.modResults.contents;

    const releaseSigningBlock = `
        release {
            def ksFile = System.getenv("VELLICHOR_KEYSTORE_FILE") ?: findProperty("VELLICHOR_KEYSTORE_FILE")
            if (ksFile) {
                storeFile file(ksFile)
                storePassword System.getenv("VELLICHOR_KEYSTORE_PASSWORD") ?: findProperty("VELLICHOR_KEYSTORE_PASSWORD")
                keyAlias System.getenv("VELLICHOR_KEY_ALIAS") ?: findProperty("VELLICHOR_KEY_ALIAS")
                keyPassword System.getenv("VELLICHOR_KEY_PASSWORD") ?: findProperty("VELLICHOR_KEY_PASSWORD")
            }
        }`;

    if (!contents.includes('VELLICHOR_KEYSTORE_FILE')) {
      contents = contents.replace(
        /signingConfigs\s*\{\s*debug\s*\{[\s\S]*?\}\s*\}/m,
        (match) => match.replace(/\}\s*$/, `${releaseSigningBlock}\n    }`)
      );

      contents = contents.replace(
        /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig\s+signingConfigs\.debug/,
        `$1def hasReleaseKey = (System.getenv("VELLICHOR_KEYSTORE_FILE") ?: findProperty("VELLICHOR_KEYSTORE_FILE")) != null\n            signingConfig hasReleaseKey ? signingConfigs.release : signingConfigs.debug`
      );
    }

    cfg.modResults.contents = contents;
    return cfg;
  });

  return config;
}

module.exports = withSecurityHardening;

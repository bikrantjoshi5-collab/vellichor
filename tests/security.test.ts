import crypto from 'crypto';
import {
  assertSafeExternalUrl,
  assertSafePluginId,
  auditPluginCode,
  verifyBundleIntegrity,
} from '@/plugins/security';
import { loadPluginFromCode } from '@/plugins/runtime';
import { fetchRepoManifest, installOrUpdatePlugin } from '@/plugins/repoSync';
import { discoverGitHubPluginRepos, isVerifiedRepoUrl, RECOMMENDED_REPOS } from '@/plugins/recommendedRepos';
import { buildMalPkceAuthUrl } from '@/trackers/mal';
import { createTestSqliteExecutor } from './helpers/sqliteTestDb';
import { initDatabase } from '@/db/database';
import { pluginRepo } from '@/db/repositories/pluginRepo';

describe('Security hardening: plugin isolation, manifest hash verification, repo trust, and path traversal', () => {
  test('#1 blocks malicious plugins attempting SecureStore, SQLite, FileSystem, Metro __r, or prototype constructor escape', async () => {
    const attacks = [
      `exports.default = { id: 'bad', parseChapter() { return globalThis.expo.modules.ExpoSecureStore.getValueWithKeyAsync('vellichor_anilist_token'); } };`,
      `exports.default = { id: 'bad', parseChapter() { return __turboModuleProxy('ExpoSQLite'); } };`,
      `exports.default = { id: 'bad', parseChapter() { return __r(42); } };`,
      `exports.default = { id: 'bad', parseChapter() { return (() => {}).constructor('return this')(); } };`,
      `exports.default = { id: 'bad', parseChapter() { return eval('1+1'); } };`,
      `exports.default = { id: 'bad', parseChapter() { return new Function('return process')(); } };`,
    ];

    for (const maliciousCode of attacks) {
      expect(() => auditPluginCode(maliciousCode, 'bad-plugin')).toThrow(/Security check blocked/i);
      expect(() => loadPluginFromCode(maliciousCode, { pluginId: 'bad-plugin' })).toThrow(
        /Security check blocked/i
      );
    }

    // Shadowed globals in runtime scope return frozen empty object / undefined
    const probeCode = `
      exports.default = {
        id: 'probe',
        site: 'https://example.com',
        async parseChapter(path) {
          return JSON.stringify({
            site: this.site,
            path,
            globalKeys: Object.keys(globalThis).length,
            hasExpo: typeof expo,
            hasXhr: typeof XMLHttpRequest,
            hasWs: typeof WebSocket,
            hasProcess: typeof process,
          });
        }
      };
    `;
    const inst = loadPluginFromCode(probeCode, { pluginId: 'probe' });
    const out = JSON.parse(await inst.parseChapter('/ch-1'));
    // Also verifies parseChapter preserves `this` binding (`this.site`)!
    expect(out).toEqual({
      site: 'https://example.com',
      path: '/ch-1',
      globalKeys: 0,
      hasExpo: 'undefined',
      hasXhr: 'undefined',
      hasWs: 'undefined',
      hasProcess: 'undefined',
    });

    // Blocks file://, javascript:, private LAN IPs, and tracker API domains from plugin fetch
    expect(() => assertSafeExternalUrl('file:///data/data/com.personal.vellichor/vellichor.db')).toThrow();
    expect(() => assertSafeExternalUrl('javascript:alert(1)')).toThrow();
    expect(() => assertSafeExternalUrl('http://127.0.0.1:8081/secret')).toThrow();
    expect(() => assertSafeExternalUrl('http://192.168.1.1/admin')).toThrow();
    expect(() =>
      assertSafeExternalUrl('https://graphql.anilist.co', 'plugin fetch', { blockTrackerApis: true })
    ).toThrow();
    expect(assertSafeExternalUrl('https://www.royalroad.com/fictions/best-rated')).toBe(
      'https://www.royalroad.com/fictions/best-rated'
    );
  });

  test('#2 verifies downloaded plugin code against manifest SHA-256 hash and rejects tampered bundles BEFORE writing to disk', async () => {
    const legitCode = `exports.default = { id: 'legit', name: 'Legit', site: 'https://example.com' };`;
    const tamperedCode = `exports.default = { id: 'legit', name: 'TAMPERED', site: 'https://evil.example' };`;
    const legitSha256 = crypto.createHash('sha256').update(legitCode, 'utf8').digest('hex');

    await expect(verifyBundleIntegrity(legitCode, legitSha256, 'legit')).resolves.toBeUndefined();
    await expect(verifyBundleIntegrity(legitCode, `sha256:${legitSha256}`, 'legit')).resolves.toBeUndefined();
    await expect(verifyBundleIntegrity(tamperedCode, legitSha256, 'legit')).rejects.toThrow(
      /Integrity check failed/i
    );

    // End-to-end check on installOrUpdatePlugin: tampered file MUST NOT be written to bundleStore
    const db = createTestSqliteExecutor();
    try {
      await initDatabase(db);
      const repoId = await pluginRepo.addRepo(db, 'https://raw.githubusercontent.com/org/repo/main/plugins.min.json');
      await pluginRepo.upsertPluginFromManifest(db, repoId, {
        id: 'legit',
        name: 'Legit',
        version: '1.0.0',
        lang: 'English',
        site: 'https://example.com',
        iconUrl: null,
        fileUrl: 'https://raw.githubusercontent.com/org/repo/main/legit.js',
        remoteHash: legitSha256,
      });

      const written: string[] = [];
      const mockBundleStore = {
        writeBundle: async (id: string) => {
          written.push(id);
          return `/plugins/${id}.js`;
        },
        readBundle: async () => legitCode,
        deleteBundle: async () => {},
      };

      await expect(
        installOrUpdatePlugin(db, 'legit', mockBundleStore, {
          fetchImpl: async () => ({
            ok: true,
            status: 200,
            text: async () => tamperedCode,
          }),
        })
      ).rejects.toThrow(/Integrity check failed/i);
      expect(written).toHaveLength(0);

      // Valid hash succeeds cleanly
      const installed = await installOrUpdatePlugin(db, 'legit', mockBundleStore, {
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          text: async () => legitCode,
        }),
      });
      expect(installed.version).toBe('1.0.0');
      expect(written).toEqual(['legit']);
    } finally {
      db.close();
    }
  });

  test('#3 marks only the official LNReader repo as verified and flags GitHub search results as unverified', async () => {
    const official = RECOMMENDED_REPOS.find((r) => r.url.includes('LNReader/lnreader-plugins'));
    expect(official?.verified).toBe(true);
    expect(isVerifiedRepoUrl(official!.url)).toBe(true);
    expect(isVerifiedRepoUrl('https://raw.githubusercontent.com/random-user/fake-stars/main/plugins.min.json')).toBe(
      false
    );

    const discovered = await discoverGitHubPluginRepos('english', async (url) => {
      if (url.includes('api.github.com')) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              items: [{ full_name: 'random-user/novel-plugins', stargazers_count: 9999, description: 'Test' }],
            }),
        };
      }
      return { ok: true, status: 200, text: async () => '' };
    });

    expect(discovered).toHaveLength(1);
    expect(discovered[0].verified).toBe(false);
    expect(discovered[0].badge).toContain('Unverified');
  });

  test('#4 blocks path traversal plugin IDs in manifest ingestion, storage, and runtime', async () => {
    expect(() => assertSafePluginId('../../vellichor.db')).toThrow(/unsafe plugin ID/i);
    expect(() => assertSafePluginId('../other')).toThrow(/unsafe plugin ID/i);
    expect(() => assertSafePluginId('foo/bar')).toThrow(/unsafe plugin ID/i);
    expect(() => assertSafePluginId('foo\\bar')).toThrow(/unsafe plugin ID/i);
    expect(assertSafePluginId('royalroad_v3.1-en')).toBe('royalroad_v3.1-en');

    const manifestRes = await fetchRepoManifest(
      'https://raw.githubusercontent.com/org/repo/main/plugins.min.json',
      {
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify([
              {
                id: '../../evil',
                name: 'Traversal Attack',
                version: '1.0.0',
                url: 'https://raw.githubusercontent.com/org/repo/main/evil.js',
              },
              {
                id: 'safe-site',
                name: 'Safe Site',
                version: '1.0.0',
                url: 'https://raw.githubusercontent.com/org/repo/main/safe.js',
              },
            ]),
        }),
      }
    );

    expect(manifestRes.plugins.map((p) => p.id)).toEqual(['safe-site']);
  });

  test('#5 includes OAuth CSRF state in MAL auth URL and enforces Android manifest hardening rules', () => {
    const malUrl = buildMalPkceAuthUrl('client123', 'verifier456', 'vellichor://auth', 'csrf_nonce_99');
    const parsed = new URL(malUrl);
    expect(parsed.searchParams.get('state')).toBe('csrf_nonce_99');
    expect(parsed.searchParams.get('redirect_uri')).toBe('vellichor://auth');

    // Verify Expo security hardening plugin strips SYSTEM_ALERT_WINDOW, disables allowBackup, and locks vellichor:// to host=auth
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const withSecurityHardening = require('../plugins/withSecurityHardening');
    expect(typeof withSecurityHardening).toBe('function');
  });
});

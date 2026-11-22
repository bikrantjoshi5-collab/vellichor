import { compareSemver, detectPluginUpdate } from '@/plugins/semver';
import { fetchRepoManifest, resolveRepoAssetUrl } from '@/plugins/repoSync';
import { loadPluginFromCode } from '@/plugins/runtime';

describe('LNReader GitHub extension updater and sandboxed plugin runtime', () => {
  test('compares semver accurately and flags both semver bump AND silent same-version hash change', () => {
    expect(compareSemver('2.5.0', '2.4.1')).toBeGreaterThan(0);
    expect(compareSemver('2.10.0', '2.9.9')).toBeGreaterThan(0);
    expect(compareSemver('2.4.1', '2.4.1')).toBe(0);

    expect(
      detectPluginUpdate({
        installedVersion: '2.4.1',
        remoteVersion: '2.5.0',
        installedHash: 'aaa',
        remoteHash: 'bbb',
      })
    ).toEqual({ hasUpdate: true, reason: 'version' });

    // Review Focus #1: upstream hotfix without version bump
    expect(
      detectPluginUpdate({
        installedVersion: '2.4.1',
        remoteVersion: '2.4.1',
        installedHash: 'old_sha256',
        remoteHash: 'new_sha256',
      })
    ).toEqual({ hasUpdate: true, reason: 'hash' });

    expect(
      detectPluginUpdate({
        installedVersion: '2.5.0',
        remoteVersion: '2.5.0',
        installedHash: 'same_sha256',
        remoteHash: 'same_sha256',
      })
    ).toEqual({ hasUpdate: false, reason: 'none' });

    // Regression: ETag change detects silent upstream GitHub hotfix when manifest has no hash field
    expect(
      detectPluginUpdate({
        installedVersion: '2.5.0',
        remoteVersion: '2.5.0',
        installedHash: 'fnv-local-1',
        remoteHash: null,
        installedEtag: '"etag-old"',
        remoteEtag: '"etag-new"',
      })
    ).toEqual({ hasUpdate: true, reason: 'etag' });

    // Regression: matching manifest hash does NOT false-loop when local FNV hash differs from manifest SHA-256
    expect(
      detectPluginUpdate({
        installedVersion: '2.5.0',
        remoteVersion: '2.5.0',
        installedHash: 'fnv-local-1',
        installedManifestHash: 'sha256-xyz',
        remoteHash: 'sha256-xyz',
      })
    ).toEqual({ hasUpdate: false, reason: 'none' });
  });

  test('busts GitHub raw CDN cache when fetching plugins.min.json and resolves relative asset paths', async () => {
    const repoUrl = 'https://raw.githubusercontent.com/user/lnreader-plugins/plugins/v3.0.0/.dist/plugins.min.json';
    const seenRequests: Array<{ url: string; headers: Record<string, string> }> = [];

    const mockFetch = async (url: string, init?: { headers?: Record<string, string> }) => {
      seenRequests.push({ url, headers: init?.headers ?? {} });
      return {
        ok: true,
        status: 200,
        headers: { get: (k: string) => (k.toLowerCase() === 'etag' ? '"etag-99"' : null) },
        text: async () =>
          JSON.stringify([
            {
              id: 'novelbin',
              name: 'NovelBin',
              version: '2.5.0',
              lang: 'English',
              site: 'https://novelbin.com',
              icon: 'src/en/novelbin/icon.png',
              url: 'https://raw.githubusercontent.com/user/lnreader-plugins/plugins/v3.0.0/.dist/en/novelbin.js',
            },
          ]),
      };
    };

    const result = await fetchRepoManifest(repoUrl, {
      fetchImpl: mockFetch,
      nowMs: 1700000000000,
    });

    expect(seenRequests).toHaveLength(1);
    expect(seenRequests[0].url).toContain('?t=1700000000000');
    expect(seenRequests[0].headers['Cache-Control']).toContain('no-cache');
    expect(result.etag).toBe('"etag-99"');
    expect(result.plugins).toHaveLength(1);
    expect(result.plugins[0].id).toBe('novelbin');
    expect(result.plugins[0].iconUrl).toBe(
      'https://raw.githubusercontent.com/user/lnreader-plugins/plugins/v3.0.0/src/en/novelbin/icon.png'
    );

    expect(resolveRepoAssetUrl(repoUrl, '.dist/en/test.js')).toBe(
      'https://raw.githubusercontent.com/user/lnreader-plugins/plugins/v3.0.0/.dist/en/test.js'
    );
  });

  test('executes a compiled LNReader v3 CommonJS plugin using cheerio, @libs/fetch, and @libs/storage', async () => {
    const kv = new Map<string, string>();
    const pluginCode = `
      const { load } = require('cheerio');
      const { fetchApi } = require('@libs/fetch');
      const { storage } = require('@libs/storage');

      class FixturePlugin {
        constructor() {
          this.id = 'fixture-novel';
          this.name = 'Fixture Source';
          this.site = 'https://fixture.example';
          this.version = '1.2.0';
        }
        async popularNovels(page) {
          storage.set('lastPage', String(page));
          const res = await fetchApi(this.site + '/popular?p=' + page);
          const $ = load(await res.text());
          const out = [];
          $('.book').each((_, el) => {
            out.push({
              name: $(el).find('h3').text().trim(),
              path: $(el).find('a').attr('href'),
              cover: $(el).find('img').attr('src')
            });
          });
          return out;
        }
        async searchNovels(term) {
          return [{ name: 'Search: ' + term, path: '/n/search', cover: '' }];
        }
        async parseNovel(path) {
          const res = await fetchApi(this.site + path);
          const $ = load(await res.text());
          return {
            path,
            name: $('h1').text().trim(),
            author: $('.author').text().trim(),
            summary: $('.summary').text().trim(),
            chapters: $('.ch').map((i, el) => ({
              name: $(el).text().trim(),
              path: $(el).attr('href'),
              chapterNumber: i + 1
            })).get()
          };
        }
        async parseChapter(path) {
          const res = await fetchApi(this.site + path);
          const $ = load(await res.text());
          return $('.prose').html() || '';
        }
      }
      exports.default = new FixturePlugin();
    `;

    const mockFetch = async (url: string) => {
      if (url.includes('/popular')) {
        return {
          ok: true,
          status: 200,
          text: async () => `<div class="book"><a href="/n/1"><h3>Shadow Slave</h3></a><img src="/c1.jpg"/></div>`,
          json: async () => ({}),
        };
      }
      if (url.includes('/n/1')) {
        return {
          ok: true,
          status: 200,
          text: async () => `<h1>Shadow Slave</h1><span class="author">Guiltythree</span><p class="summary">Nightmare spell.</p><a class="ch" href="/ch/1">Chapter 1</a>`,
          json: async () => ({}),
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => `<div class="prose"><p>The first shadow stirred.</p><img src="https://cdn.example/art.jpg"/></div>`,
        json: async () => ({}),
      };
    };

    const plugin = loadPluginFromCode(pluginCode, {
      pluginId: 'fixture-novel',
      fetchImpl: mockFetch,
      storage: {
        get: (k) => kv.get(k) ?? null,
        set: (k, v) => { kv.set(k, v); },
        delete: (k) => { kv.delete(k); },
      },
    });

    const popular = await plugin.popularNovels(1);
    expect(popular).toEqual([{ name: 'Shadow Slave', path: '/n/1', cover: '/c1.jpg' }]);
    expect(kv.get('lastPage')).toBe('1');

    const novel = await plugin.parseNovel('/n/1');
    expect(novel.name).toBe('Shadow Slave');
    expect(novel.chapters).toHaveLength(1);
    expect(novel.chapters[0].path).toBe('/ch/1');

    const html = await plugin.parseChapter('/ch/1');
    expect(html).toContain('The first shadow stirred.');
    expect(html).toContain('https://cdn.example/art.jpg');
  });
});

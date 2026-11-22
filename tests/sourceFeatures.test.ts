import {
  cloneFilters,
  countActiveFilters,
  cycleExcludableOption,
  resetFilters,
  toggleCheckboxOption,
  updateFilterValue,
} from '@/plugins/filters';
import { searchAcrossInstalledPlugins } from '@/plugins/globalSearch';
import { RECOMMENDED_REPOS, discoverGitHubPluginRepos } from '@/plugins/recommendedRepos';
import { loadPluginFromCode } from '@/plugins/runtime';
import { FilterTypes } from '@/plugins/shims';
import type { PluginFilters, PluginInstance } from '@/plugins/types';

describe('Unlimited per-site filters, ordered global search, and recommended repos', () => {
  test('supports all 5 LNReader FilterTypes with zero cap on filter count and exact tri-state include/exclude cycling', () => {
    const baseFilters: PluginFilters = {
      keyword: { type: FilterTypes.TextInput, label: 'Keyword', value: '' },
      sort: {
        type: FilterTypes.Picker,
        label: 'Order by',
        value: 'popularity',
        options: [
          { label: 'Popular', value: 'popularity' },
          { label: 'Rating', value: 'rating' },
        ],
      },
      completedOnly: { type: FilterTypes.Switch, label: 'Completed Only', value: false },
      status: {
        type: FilterTypes.CheckboxGroup,
        label: 'Status',
        value: [],
        options: [
          { label: 'Ongoing', value: 'ongoing' },
          { label: 'Hiatus', value: 'hiatus' },
        ],
      },
      genres: {
        type: FilterTypes.ExcludableCheckboxGroup,
        label: 'Genres',
        value: { include: [], exclude: [] },
        options: [
          { label: 'Fantasy', value: 'fantasy' },
          { label: 'Horror', value: 'horror' },
        ],
      },
    };

    let state = cloneFilters(baseFilters);
    expect(countActiveFilters(state, baseFilters)).toBe(0);

    state = updateFilterValue(state, 'keyword', 'mysteries');
    state = updateFilterValue(state, 'sort', 'rating');
    state = updateFilterValue(state, 'completedOnly', true);
    state = toggleCheckboxOption(state, 'status', 'ongoing');

    // Tri-state cycle: neutral -> include -> exclude -> neutral
    state = cycleExcludableOption(state, 'genres', 'fantasy');
    expect(state.genres.value).toEqual({ include: ['fantasy'], exclude: [] });

    state = cycleExcludableOption(state, 'genres', 'fantasy');
    expect(state.genres.value).toEqual({ include: [], exclude: ['fantasy'] });

    expect(countActiveFilters(state, baseFilters)).toBe(5);

    state = cycleExcludableOption(state, 'genres', 'fantasy');
    expect(state.genres.value).toEqual({ include: [], exclude: [] });

    const reset = resetFilters(baseFilters);
    expect(countActiveFilters(reset, baseFilters)).toBe(0);
    expect(reset.keyword.value).toBe('');
  });

  test('exposes plugin.filters dynamically from compiled LNReader bundle and forwards updated filters to popularNovels', async () => {
    const code = `
      const { FilterTypes } = require('@libs/filterInputs');
      class DynamicSite {
        constructor() {
          this.id = 'dyn-site';
          this.name = 'Dynamic Site';
          this.site = 'https://dyn.example';
          this.version = '1.0.0';
          this.filters = {
            order: { type: FilterTypes.Picker, label: 'Order', value: 'top', options: [{ label: 'Top', value: 'top' }, { label: 'New', value: 'new' }] },
            tags: { type: FilterTypes.ExcludableCheckboxGroup, label: 'Tags', value: { include: [], exclude: [] }, options: [{ label: 'LitRPG', value: 'litrpg' }] },
          };
        }
        async popularNovels(page, opts) {
          const order = opts.filters.order.value;
          const inc = opts.filters.tags.value.include.join(',');
          return [{ name: order + ':' + inc + ':p' + page + ':latest=' + Boolean(opts.showLatestNovels), path: '/n/1' }];
        }
        async searchNovels() { return []; }
        async parseNovel(p) { return { path: p, name: 'N', chapters: [] }; }
        async parseChapter() { return ''; }
      }
      exports.default = new DynamicSite();
    `;

    const plugin = loadPluginFromCode(code, { pluginId: 'dyn-site' });
    expect(Object.keys(plugin.filters ?? {})).toEqual(['order', 'tags']);

    let f = cloneFilters(plugin.filters!);
    f = updateFilterValue(f, 'order', 'new');
    f = cycleExcludableOption(f, 'tags', 'litrpg');

    const res = await plugin.popularNovels(2, { filters: f, showLatestNovels: true });
    expect(res[0].name).toBe('new:litrpg:p2:latest=true');
  });

  test('searches every installed source strictly in order and isolates failing sites', async () => {
    const order: string[] = [];
    const makePlugin = (id: string, name: string, fail = false): PluginInstance => ({
      id,
      name,
      site: `https://${id}.example`,
      version: '1.0.0',
      popularNovels: async () => [],
      parseNovel: async (p) => ({ path: p, name, chapters: [] }),
      parseChapter: async () => '',
      searchNovels: async (q) => {
        order.push(id);
        if (fail) throw new Error('Site down');
        return [{ name: `${name}: ${q}`, path: `/book/${id}`, cover: '/cover.jpg' }];
      },
    });

    const plugins = [
      makePlugin('first', 'First Site'),
      makePlugin('broken', 'Broken Site', true),
      makePlugin('third', 'Third Site'),
    ];

    const streamed: string[] = [];
    const groups = await searchAcrossInstalledPlugins(plugins, 'Shadow Slave', {
      onGroupReady: (g) => streamed.push(`${g.pluginId}:${g.error ? 'err' : g.novels.length}`),
    });

    expect(order).toEqual(['first', 'broken', 'third']);
    expect(streamed).toEqual(['first:1', 'broken:err', 'third:1']);
    expect(groups[0].novels[0].cover).toBe('https://first.example/cover.jpg');
    expect(groups[1].error).toContain('Site down');
    expect(groups[2].novels).toHaveLength(1);
  });

  test('provides curated recommended repos and probes GitHub search results for valid plugins.min.json manifests', async () => {
    expect(RECOMMENDED_REPOS.length).toBeGreaterThanOrEqual(2);
    expect(RECOMMENDED_REPOS[0].url).toContain('plugins.min.json');

    const mockFetch = async (url: string) => {
      if (url.includes('api.github.com/search/repositories')) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              items: [
                { full_name: 'demo/lnreader-plugins', stargazers_count: 55, description: 'Custom LN sources' },
                { full_name: 'empty/no-manifest', stargazers_count: 10, description: 'No dist branch' },
              ],
            }),
        };
      }
      if (url.includes('demo/lnreader-plugins')) {
        return { ok: true, status: 200, text: async () => '[]' };
      }
      return { ok: false, status: 404, text: async () => '' };
    };

    const found = await discoverGitHubPluginRepos('lnreader', mockFetch);
    expect(found).toHaveLength(1);
    expect(found[0].name).toBe('demo/lnreader-plugins');
    expect(found[0].url).toContain('raw.githubusercontent.com/demo/lnreader-plugins');
  });
});

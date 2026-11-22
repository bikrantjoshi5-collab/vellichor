import type { PluginInstance, PluginNovelItem } from './types';

export interface GlobalSearchGroup {
  pluginId: string;
  pluginName: string;
  pluginSite: string;
  iconUrl?: string | null;
  novels: PluginNovelItem[];
  error: string | null;
}

function resolveCoverUrl(cover: string | undefined, site: string): string | undefined {
  if (!cover) return undefined;
  if (/^https?:\/\//i.test(cover)) return cover;
  if (cover.startsWith('//')) return `https:${cover}`;
  if (!site) return cover;
  return `${site.replace(/\/$/, '')}/${cover.replace(/^\//, '')}`;
}

/**
 * Searches every installed plugin strictly in order, streaming each source's results
 * immediately via onGroupReady while isolating failures so one broken site never stops the rest.
 */
export async function searchAcrossInstalledPlugins(
  plugins: PluginInstance[],
  query: string,
  opts: {
    iconById?: Record<string, string | null | undefined>;
    signal?: { aborted: boolean };
    onGroupReady?: (group: GlobalSearchGroup) => void;
  } = {}
): Promise<GlobalSearchGroup[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const groups: GlobalSearchGroup[] = [];
  for (const plugin of plugins) {
    if (opts.signal?.aborted) break;
    let group: GlobalSearchGroup;
    try {
      const raw = await plugin.searchNovels(trimmed, 1);
      const novels = raw.map((item) => ({
        ...item,
        cover: resolveCoverUrl(item.cover, plugin.site),
      }));
      group = {
        pluginId: plugin.id,
        pluginName: plugin.name,
        pluginSite: plugin.site,
        iconUrl: opts.iconById?.[plugin.id] ?? plugin.icon ?? null,
        novels,
        error: null,
      };
    } catch (err) {
      group = {
        pluginId: plugin.id,
        pluginName: plugin.name,
        pluginSite: plugin.site,
        iconUrl: opts.iconById?.[plugin.id] ?? plugin.icon ?? null,
        novels: [],
        error: err instanceof Error ? err.message : 'Search failed',
      };
    }
    groups.push(group);
    opts.onGroupReady?.(group);
  }
  return groups;
}

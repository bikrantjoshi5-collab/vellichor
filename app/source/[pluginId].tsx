import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { FlashList } from '@shopify/flash-list';
import { ArrowLeft, Search, SlidersHorizontal, X } from 'lucide-react-native';
import { mossColors, motion, radius, spacing } from '@/theme';
import { useAppStore } from '@/store/appStore';
import { getRuntimePlugin } from '@/services/pluginLoader';
import { libraryRepo } from '@/db/repositories/libraryRepo';
import { chapterRepo } from '@/db/repositories/chapterRepo';
import { cloneFilters, countActiveFilters, resetFilters } from '@/plugins/filters';
import type { PluginFilters, PluginNovelItem } from '@/plugins/types';
import { ThemedText } from '@/components/ThemedText';
import { Button } from '@/components/Button';
import { NovelCover } from '@/components/NovelCover';
import { ExtensionLogo } from '@/components/ExtensionLogo';
import { SourceFilterSheet } from '@/components/SourceFilterSheet';

export default function SourceBrowseScreen() {
  const { pluginId } = useLocalSearchParams<{ pluginId: string }>();
  const router = useRouter();
  const db = useAppStore((s) => s.db);
  const plugins = useAppStore((s) => s.plugins);

  const meta = plugins.find((p) => p.id === pluginId);
  const [items, setItems] = useState<PluginNovelItem[]>([]);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [openingPath, setOpeningPath] = useState<string | null>(null);

  // Unlimited per-website dynamic filters
  const [baseFilters, setBaseFilters] = useState<PluginFilters>({});
  const [activeFilters, setActiveFilters] = useState<PluginFilters>({});
  const [showLatestNovels, setShowLatestNovels] = useState(false);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);

  const activeFilterCount = useMemo(
    () => countActiveFilters(activeFilters, baseFilters) + (showLatestNovels ? 1 : 0),
    [activeFilters, baseFilters, showLatestNovels]
  );

  const resolveCover = (cover: string | undefined, site: string): string | undefined => {
    if (!cover) return undefined;
    if (/^https?:\/\//i.test(cover)) return cover;
    if (cover.startsWith('//')) return `https:${cover}`;
    if (!site) return cover;
    return `${site.replace(/\/$/, '')}/${cover.replace(/^\//, '')}`;
  };

  const fetchCatalog = async (opts: {
    pageNo: number;
    append: boolean;
    filtersOverride?: PluginFilters;
    latestOverride?: boolean;
    searchOverride?: string;
  }) => {
    if (!db || !pluginId) return;
    if (opts.append) setLoadingMore(true);
    else setLoading(true);
    try {
      const plugin = await getRuntimePlugin(db, pluginId);
      if (!plugin) throw new Error('Extension not installed');

      const pluginBase = cloneFilters(plugin.filters);
      if (Object.keys(baseFilters).length === 0 && Object.keys(pluginBase).length > 0) {
        setBaseFilters(pluginBase);
        if (!opts.filtersOverride) {
          setActiveFilters(cloneFilters(pluginBase));
        }
      }

      const term = (opts.searchOverride ?? query).trim();
      const filtersToUse = opts.filtersOverride ?? (Object.keys(activeFilters).length > 0 ? activeFilters : pluginBase);
      const latestToUse = opts.latestOverride ?? showLatestNovels;

      const res = term
        ? await plugin.searchNovels(term, opts.pageNo)
        : await plugin.popularNovels(opts.pageNo, {
            filters: filtersToUse,
            showLatestNovels: latestToUse,
          });

      const normalized = res.map((n) => ({ ...n, cover: resolveCover(n.cover, plugin.site) }));
      setPage(opts.pageNo);
      setItems((prev) => (opts.append ? [...prev, ...normalized] : normalized));
    } catch (err) {
      Alert.alert('Source Error', err instanceof Error ? err.message : 'Unable to load catalog');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    void fetchCatalog({ pageNo: 1, append: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, pluginId]);

  const openNovel = async (item: PluginNovelItem) => {
    if (!db || !pluginId) return;
    setOpeningPath(item.path);
    try {
      const plugin = await getRuntimePlugin(db, pluginId);
      if (!plugin) throw new Error('Extension not installed');
      const parsed = await plugin.parseNovel(item.path);
      const novelId = await libraryRepo.upsertNovel(db, {
        pluginId,
        path: item.path,
        title: parsed.name || item.name,
        author: parsed.author ?? null,
        coverUrl: resolveCover(parsed.cover, plugin.site) || item.cover || null,
        summary: parsed.summary ?? null,
        sourceStatus: parsed.status ?? null,
      });
      await chapterRepo.upsertChapters(
        db,
        novelId,
        parsed.chapters.map((c, idx) => ({
          path: c.path,
          name: c.name,
          chapterNumber: c.chapterNumber ?? idx + 1,
          releaseDate: c.releaseTime ?? null,
        }))
      );
      router.push({ pathname: '/novel/[id]', params: { id: String(novelId) } });
    } catch (err) {
      Alert.alert('Unable to Open Novel', err instanceof Error ? err.message : 'Parse failed');
    } finally {
      setOpeningPath(null);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn}>
          <ArrowLeft size={18} color={mossColors.fg} strokeWidth={1.8} />
        </Pressable>
        <ExtensionLogo uri={meta?.icon_url} name={meta?.name || String(pluginId)} size={32} />
        <ThemedText variant="sectionTitle" style={{ flex: 1 }} numberOfLines={1}>
          {meta?.name || pluginId}
        </ThemedText>
        <Pressable
          testID="source-filter-open"
          accessibilityRole="button"
          accessibilityLabel="Open website filters"
          onPress={() => setFilterSheetOpen(true)}
          style={[styles.filterBtn, activeFilterCount > 0 && styles.filterBtnActive]}
        >
          <SlidersHorizontal
            size={16}
            color={activeFilterCount > 0 ? mossColors.accentFg : mossColors.fg}
            strokeWidth={1.9}
          />
          <ThemedText
            variant="caption"
            style={{ color: activeFilterCount > 0 ? mossColors.accentFg : mossColors.fg }}
          >
            {activeFilterCount > 0 ? `Filters (${activeFilterCount})` : 'Filters'}
          </ThemedText>
        </Pressable>
      </View>

      <View style={styles.searchRow}>
        <Search size={16} color={mossColors.muted} strokeWidth={1.8} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={`Search ${meta?.name || 'source'}...`}
          placeholderTextColor={mossColors.muted}
          style={styles.input}
          returnKeyType="search"
          onSubmitEditing={() => void fetchCatalog({ pageNo: 1, append: false })}
        />
        {query.length > 0 ? (
          <Pressable
            onPress={() => {
              setQuery('');
              void fetchCatalog({ pageNo: 1, append: false, searchOverride: '' });
            }}
            hitSlop={6}
          >
            <X size={16} color={mossColors.muted} strokeWidth={1.8} />
          </Pressable>
        ) : null}
        <Button title="Go" size="sm" onPress={() => void fetchCatalog({ pageNo: 1, append: false })} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={mossColors.accent} />
        </View>
      ) : (
        <FlashList
          data={items}
          numColumns={2}
          estimatedItemSize={240}
          keyExtractor={(item, idx) => `${item.path}-${idx}`}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => void openNovel(item)}
              style={({ pressed }) => [
                styles.card,
                pressed && { transform: [{ scale: motion.pressScale }] },
              ]}
            >
              <NovelCover uri={item.cover} title={item.name} style={styles.cover} />
              <ThemedText variant="cardTitle" numberOfLines={2}>
                {openingPath === item.path ? 'Opening…' : item.name}
              </ThemedText>
            </Pressable>
          )}
          ListFooterComponent={
            items.length > 0 ? (
              <View style={styles.footerMore}>
                <Button
                  title={loadingMore ? 'Loading…' : `Load Page ${page + 1}`}
                  variant="secondary"
                  loading={loadingMore}
                  onPress={() => void fetchCatalog({ pageNo: page + 1, append: true })}
                />
              </View>
            ) : null
          }
        />
      )}

      <SourceFilterSheet
        visible={filterSheetOpen}
        sourceName={meta?.name || String(pluginId)}
        filters={activeFilters}
        showLatestNovels={showLatestNovels}
        onChangeFilters={setActiveFilters}
        onChangeShowLatest={setShowLatestNovels}
        onReset={() => {
          const fresh = resetFilters(baseFilters);
          setActiveFilters(fresh);
          setShowLatestNovels(false);
        }}
        onApply={() => {
          setQuery('');
          void fetchCatalog({
            pageNo: 1,
            append: false,
            filtersOverride: activeFilters,
            latestOverride: showLatestNovels,
            searchOverride: '',
          });
        }}
        onClose={() => setFilterSheetOpen(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: mossColors.bg,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    backgroundColor: mossColors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.smd,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: mossColors.surface,
  },
  filterBtnActive: {
    backgroundColor: mossColors.accent,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    marginBottom: spacing.smd,
    paddingHorizontal: spacing.smd,
    paddingVertical: spacing.xs,
    borderRadius: radius.md,
    backgroundColor: mossColors.surface,
  },
  input: {
    flex: 1,
    color: mossColors.fg,
    fontSize: 14,
    paddingVertical: spacing.sm,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: {
    paddingHorizontal: spacing.smd,
    paddingBottom: spacing.xl,
  },
  card: {
    flex: 1,
    margin: spacing.xs + 2,
    padding: spacing.sm,
    borderRadius: radius.card,
    backgroundColor: mossColors.surface,
    gap: spacing.sm,
  },
  cover: {
    width: '100%',
    aspectRatio: 4 / 5,
  },
  footerMore: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xs,
  },
});

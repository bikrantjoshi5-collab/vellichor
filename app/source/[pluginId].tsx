import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { FlashList } from '@shopify/flash-list';
import { ArrowLeft, Search } from 'lucide-react-native';
import { mossColors, motion, radius, spacing } from '@/theme';
import { useAppStore } from '@/store/appStore';
import { getRuntimePlugin } from '@/services/pluginLoader';
import { libraryRepo } from '@/db/repositories/libraryRepo';
import { chapterRepo } from '@/db/repositories/chapterRepo';
import type { PluginNovelItem } from '@/plugins/types';
import { ThemedText } from '@/components/ThemedText';
import { Button } from '@/components/Button';
import { NovelCover } from '@/components/NovelCover';

export default function SourceBrowseScreen() {
  const { pluginId } = useLocalSearchParams<{ pluginId: string }>();
  const router = useRouter();
  const db = useAppStore((s) => s.db);
  const plugins = useAppStore((s) => s.plugins);

  const meta = plugins.find((p) => p.id === pluginId);
  const [items, setItems] = useState<PluginNovelItem[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [openingPath, setOpeningPath] = useState<string | null>(null);

  const loadPopular = async () => {
    if (!db || !pluginId) return;
    setLoading(true);
    try {
      const plugin = await getRuntimePlugin(db, pluginId);
      if (!plugin) throw new Error('Extension not installed');
      const res = await plugin.popularNovels(1);
      setItems(res);
    } catch (err) {
      Alert.alert('Source Error', err instanceof Error ? err.message : 'Unable to load catalog');
    } finally {
      setLoading(false);
    }
  };

  const runSearch = async () => {
    if (!db || !pluginId) return;
    if (!query.trim()) {
      await loadPopular();
      return;
    }
    setLoading(true);
    try {
      const plugin = await getRuntimePlugin(db, pluginId);
      if (!plugin) throw new Error('Extension not installed');
      const res = await plugin.searchNovels(query.trim(), 1);
      setItems(res);
    } catch (err) {
      Alert.alert('Search Error', err instanceof Error ? err.message : 'Search failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadPopular();
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
        coverUrl: parsed.cover || item.cover || null,
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
        <ThemedText variant="sectionTitle" style={{ flex: 1 }} numberOfLines={1}>
          {meta?.name || pluginId}
        </ThemedText>
      </View>

      <View style={styles.searchRow}>
        <Search size={16} color={mossColors.muted} strokeWidth={1.8} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={`Search ${meta?.name || 'source'}...`}
          placeholderTextColor={mossColors.muted}
          style={styles.input}
          onSubmitEditing={() => void runSearch()}
        />
        <Button title="Go" size="sm" onPress={() => void runSearch()} />
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
        />
      )}
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
    gap: spacing.smd,
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
});

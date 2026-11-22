import React, { useMemo, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { FlashList } from '@shopify/flash-list';
import { BookMarked, Download, Search, X } from 'lucide-react-native';
import { mossColors, motion, radius, spacing } from '@/theme';
import { useAppStore } from '@/store/appStore';
import type { NovelWithStats, ReadingStatus } from '@/db/types';
import { ThemedText } from '@/components/ThemedText';
import { Chip } from '@/components/Chip';
import { NovelCover } from '@/components/NovelCover';
import { ProgressBar } from '@/components/ProgressBar';
import { EmptyState } from '@/components/EmptyState';

const STATUS_FILTERS: Array<{ id: ReadingStatus | 'all' | 'downloaded'; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'reading', label: 'Reading' },
  { id: 'downloaded', label: 'Downloaded' },
  { id: 'plan_to_read', label: 'Plan to Read' },
  { id: 'on_hold', label: 'On Hold' },
  { id: 'completed', label: 'Completed' },
  { id: 'dropped', label: 'Dropped' },
];

export default function LibraryScreen() {
  const router = useRouter();
  const novels = useAppStore((s) => s.novels);
  const shelves = useAppStore((s) => s.shelves);
  const activeFilter = useAppStore((s) => s.activeFilter);
  const activeShelfId = useAppStore((s) => s.activeShelfId);
  const librarySearch = useAppStore((s) => s.librarySearch);
  const checkingUpdates = useAppStore((s) => s.checkingUpdates);
  const downloadJobs = useAppStore((s) => s.downloadJobs);
  const setFilter = useAppStore((s) => s.setFilter);
  const setLibrarySearch = useAppStore((s) => s.setLibrarySearch);
  const checkUpdatesNow = useAppStore((s) => s.checkUpdatesNow);

  const [searchOpen, setSearchOpen] = useState(false);

  const activeDownloads = useMemo(
    () => downloadJobs.filter((j) => j.status === 'pending' || j.status === 'running' || j.status === 'rate_limited').length,
    [downloadJobs]
  );

  const continueNovel = novels[0] ?? null;

  const renderNovelCard = ({ item }: { item: NovelWithStats }) => {
    const pct = item.total_chapters > 0 ? Math.round((item.read_chapters / item.total_chapters) * 100) : 0;
    return (
      <Pressable
        testID={`novel-card-${item.id}`}
        onPress={() => router.push({ pathname: '/novel/[id]', params: { id: String(item.id) } })}
        style={({ pressed }) => [
          styles.card,
          pressed && { transform: [{ scale: motion.pressScale }] },
        ]}
      >
        <NovelCover uri={item.local_cover_path || item.cover_url} title={item.title} style={styles.cardCover} />
        <ThemedText variant="cardTitle" numberOfLines={2} style={styles.cardTitle}>
          {item.title}
        </ThemedText>
        <View style={styles.cardMetaRow}>
          <ThemedText variant="mono" numberOfLines={1}>
            {item.read_chapters}/{item.total_chapters}
          </ThemedText>
          {item.unread_chapters > 0 ? (
            <ThemedText variant="mono" style={{ color: mossColors.accent }}>
              +{item.unread_chapters}
            </ThemedText>
          ) : (
            <ThemedText variant="mono" style={{ color: mossColors.good }}>
              Caught up
            </ThemedText>
          )}
        </View>
        <ProgressBar progress={pct} />
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View testID="app-loaded" style={styles.header}>
        <ThemedText variant="screenTitle">Vellichor</ThemedText>
        <View style={styles.headerActions}>
          {activeDownloads > 0 ? (
            <Pressable
              testID="library-queue-pill"
              onPress={() => router.push('/queue')}
              style={styles.queuePill}
            >
              <Download size={14} color={mossColors.accentFg} strokeWidth={2} />
              <ThemedText variant="mono" style={{ color: mossColors.accentFg }}>
                {activeDownloads}
              </ThemedText>
            </Pressable>
          ) : null}
          <Pressable
            testID="library-search-toggle"
            accessibilityRole="button"
            accessibilityLabel="Search library"
            onPress={() => {
              setSearchOpen((v) => !v);
              if (searchOpen) void setLibrarySearch('');
            }}
            style={styles.iconBtn}
          >
            {searchOpen ? (
              <X size={18} color={mossColors.fg} strokeWidth={1.8} />
            ) : (
              <Search size={18} color={mossColors.fg} strokeWidth={1.8} />
            )}
          </Pressable>
        </View>
      </View>

      {searchOpen ? (
        <View style={styles.searchWrap}>
          <TextInput
            value={librarySearch}
            onChangeText={(t) => void setLibrarySearch(t)}
            placeholder="Filter your shelf by title or author..."
            placeholderTextColor={mossColors.muted}
            style={styles.searchInput}
            autoFocus
          />
        </View>
      ) : null}

      <View style={styles.chipsWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsScroll}>
          {STATUS_FILTERS.map((f) => (
            <Chip
              key={f.id}
              label={f.label}
              active={!activeShelfId && activeFilter === f.id}
              onPress={() => void setFilter(f.id, null)}
            />
          ))}
          {shelves.map((s) => (
            <Chip
              key={`shelf-${s.id}`}
              label={s.name}
              active={activeShelfId === s.id}
              onPress={() => void setFilter('all', s.id)}
            />
          ))}
        </ScrollView>
      </View>

      {novels.length === 0 ? (
        <EmptyState
          icon={<BookMarked size={38} color={mossColors.accent} strokeWidth={1.5} />}
          title="Your quiet shelf awaits"
          message="Add an LNReader-compatible GitHub extension repo in Sources to browse and save your first novel."
          actionLabel="Open Sources"
          onAction={() => router.push('/(tabs)/sources')}
        />
      ) : (
        <FlashList
          data={novels}
          numColumns={2}
          estimatedItemSize={260}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderNovelCard}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={checkingUpdates}
              onRefresh={() => void checkUpdatesNow()}
              tintColor={mossColors.accent}
            />
          }
          ListHeaderComponent={
            continueNovel ? (
              <Pressable
                testID="continue-reading-banner"
                onPress={() => {
                  if (continueNovel.last_chapter_id) {
                    router.push({
                      pathname: '/reader/[chapterId]',
                      params: { chapterId: String(continueNovel.last_chapter_id) },
                    });
                  } else {
                    router.push({
                      pathname: '/novel/[id]',
                      params: { id: String(continueNovel.id) },
                    });
                  }
                }}
                style={({ pressed }) => [
                  styles.heroBanner,
                  pressed && { transform: [{ scale: motion.pressScale }] },
                ]}
              >
                <View style={styles.heroLeft}>
                  <ThemedText variant="caption" style={{ color: mossColors.accent }}>
                    Continue Reading
                  </ThemedText>
                  <ThemedText variant="sectionTitle" numberOfLines={2}>
                    {continueNovel.title}
                  </ThemedText>
                  <ThemedText variant="caption" numberOfLines={1}>
                    {continueNovel.last_chapter_name || `Chapter ${continueNovel.read_chapters + 1}`}
                  </ThemedText>
                  <ProgressBar
                    progress={
                      continueNovel.total_chapters > 0
                        ? Math.round((continueNovel.read_chapters / continueNovel.total_chapters) * 100)
                        : 0
                    }
                    style={styles.heroProgress}
                  />
                </View>
                <NovelCover
                  uri={continueNovel.local_cover_path || continueNovel.cover_url}
                  title={continueNovel.title}
                  style={styles.heroCover}
                />
              </Pressable>
            ) : null
          }
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.smd,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    backgroundColor: mossColors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  queuePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.smd,
    paddingVertical: spacing.xs + 3,
    borderRadius: radius.full,
    backgroundColor: mossColors.accent,
  },
  searchWrap: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.smd,
  },
  searchInput: {
    backgroundColor: mossColors.surface,
    color: mossColors.fg,
    borderRadius: radius.md,
    paddingHorizontal: spacing.smd,
    paddingVertical: spacing.sm + 2,
    fontSize: 14,
  },
  chipsWrap: {
    paddingBottom: spacing.smd,
  },
  chipsScroll: {
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  listContent: {
    paddingHorizontal: spacing.smd,
    paddingBottom: spacing.xl,
  },
  heroBanner: {
    marginHorizontal: spacing.xs,
    marginBottom: spacing.md,
    padding: spacing.md,
    borderRadius: radius.card,
    borderCurve: 'continuous',
    backgroundColor: mossColors.surfaceElevated,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  heroLeft: {
    flex: 1,
    gap: spacing.xs,
  },
  heroProgress: {
    marginTop: spacing.xs,
  },
  heroCover: {
    width: 64,
    height: 94,
  },
  card: {
    flex: 1,
    margin: spacing.xs + 2,
    padding: spacing.sm + 2,
    borderRadius: radius.card,
    borderCurve: 'continuous',
    backgroundColor: mossColors.surface,
    gap: spacing.sm,
  },
  cardCover: {
    width: '100%',
    aspectRatio: 4 / 5,
  },
  cardTitle: {
    minHeight: 36,
  },
  cardMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});

import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { FlashList } from '@shopify/flash-list';
import {
  ArrowLeft,
  Bookmark,
  CheckCircle2,
  Download,
  Link2,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react-native';
import { labelPalette, mossColors, radius, spacing, type LabelColorToken } from '@/theme';
import { useAppStore } from '@/store/appStore';
import { libraryRepo } from '@/db/repositories/libraryRepo';
import { chapterRepo } from '@/db/repositories/chapterRepo';
import { trackerRepo } from '@/db/repositories/trackerRepo';
import { getRuntimePlugin } from '@/services/pluginLoader';
import { trackerAuthStore } from '@/services/trackerAuth';
import { fetchAniListProgress } from '@/trackers/anilist';
import { fetchMalProgress } from '@/trackers/mal';
import type { ChapterRow, NovelRow, ReadingStatus, ShelfRow, TrackerLinkRow } from '@/db/types';
import { ThemedText } from '@/components/ThemedText';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { NovelCover } from '@/components/NovelCover';
import { TrackerModalSheet } from '@/components/TrackerModalSheet';
import { LabelManagerSheet } from '@/components/LabelManagerSheet';

const STATUSES: Array<{ id: ReadingStatus; label: string }> = [
  { id: 'reading', label: 'Reading' },
  { id: 'plan_to_read', label: 'Plan to Read' },
  { id: 'on_hold', label: 'On Hold' },
  { id: 'completed', label: 'Completed' },
  { id: 'dropped', label: 'Dropped' },
];

export default function NovelDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const novelId = Number(id);
  const router = useRouter();

  const db = useAppStore((s) => s.db);
  const engine = useAppStore((s) => s.engine);
  const allShelves = useAppStore((s) => s.shelves);
  const downloadJobs = useAppStore((s) => s.downloadJobs);
  const refreshLibrary = useAppStore((s) => s.refreshLibrary);
  const enqueueDownloads = useAppStore((s) => s.enqueueDownloads);
  const createShelf = useAppStore((s) => s.createShelf);
  const deleteShelf = useAppStore((s) => s.deleteShelf);
  const toggleNovelLabel = useAppStore((s) => s.toggleNovelLabel);

  const [novel, setNovel] = useState<NovelRow | null>(null);
  const [chapters, setChapters] = useState<ChapterRow[]>([]);
  const [assignedShelves, setAssignedShelves] = useState<ShelfRow[]>([]);
  const [trackers, setTrackers] = useState<TrackerLinkRow[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [trackerOpen, setTrackerOpen] = useState(false);
  const [labelSheetOpen, setLabelSheetOpen] = useState(false);
  const [descOrder, setDescOrder] = useState(false);

  const loadData = useCallback(async () => {
    if (!db || !Number.isFinite(novelId)) return;
    const [n, chs, sh, tr] = await Promise.all([
      libraryRepo.getNovelById(db, novelId),
      chapterRepo.listByNovel(db, novelId, descOrder ? 'desc' : 'asc'),
      libraryRepo.getShelvesForNovel(db, novelId),
      trackerRepo.listByNovel(db, novelId),
    ]);
    setNovel(n);
    setChapters(chs);
    setAssignedShelves(sh);
    setTrackers(tr);
  }, [db, novelId, descOrder]);

  useEffect(() => {
    void loadData();
  }, [loadData, downloadJobs.length]);

  const handleRefreshFromSource = async () => {
    if (!db || !novel) return;
    setRefreshing(true);
    try {
      const plugin = await getRuntimePlugin(db, novel.plugin_id);
      if (!plugin) {
        Alert.alert('Plugin Missing', `Install "${novel.plugin_id}" in Sources first.`);
        return;
      }
      const parsed = await plugin.parseNovel(novel.path);
      await libraryRepo.upsertNovel(db, {
        pluginId: novel.plugin_id,
        path: novel.path,
        title: parsed.name || novel.title,
        author: parsed.author ?? novel.author,
        coverUrl: parsed.cover ?? novel.cover_url,
        summary: parsed.summary ?? novel.summary,
        sourceStatus: parsed.status ?? novel.source_status,
      });
      await chapterRepo.upsertChapters(
        db,
        novel.id,
        parsed.chapters.map((c, idx) => ({
          path: c.path,
          name: c.name,
          chapterNumber: c.chapterNumber ?? idx + 1,
          releaseDate: c.releaseTime ?? null,
        }))
      );
      await loadData();
      await refreshLibrary();
    } catch (err) {
      Alert.alert('Refresh Failed', err instanceof Error ? err.message : 'Unable to fetch novel');
    } finally {
      setRefreshing(false);
    }
  };

  const ascChapters = descOrder ? [...chapters].reverse() : chapters;

  const queueBatch = (mode: 'next10' | 'next50' | 'unread') => {
    if (!novel) return;
    const unread = ascChapters.filter((c) => c.is_read === 0 && c.is_downloaded === 0);
    const slice = mode === 'next10' ? unread.slice(0, 10) : mode === 'next50' ? unread.slice(0, 50) : unread;
    if (slice.length === 0) {
      Alert.alert('Nothing to Download', 'All matching chapters are already downloaded.');
      return;
    }
    void enqueueDownloads(novel.id, novel.plugin_id, slice.map((c) => c.id));
    Alert.alert('Queued Safely', `Queued ${slice.length} chapter(s) with polite per-source throttling.`);
  };

  if (!novel) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} style={styles.iconBtn}>
            <ArrowLeft size={18} color={mossColors.fg} />
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // Smartly resume the exact in-progress chapter (always in ascending reading order, even if UI shows Newest first)
  const resumeChapter =
    ascChapters.find((c) => c.read_progress_pct > 0 && c.read_progress_pct < 92) ??
    ascChapters.find((c) => c.is_read === 0) ??
    ascChapters[0] ??
    null;

  const resumeLabel =
    resumeChapter && resumeChapter.read_progress_pct > 0 && resumeChapter.read_progress_pct < 92
      ? `Resume · ${Math.round(resumeChapter.read_progress_pct)}%`
      : 'Read';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn}>
          <ArrowLeft size={18} color={mossColors.fg} strokeWidth={1.8} />
        </Pressable>
        <View style={styles.topActions}>
          <Pressable onPress={() => setTrackerOpen(true)} style={styles.iconBtn}>
            <Link2 size={18} color={trackers.length > 0 ? mossColors.good : mossColors.fg} strokeWidth={1.8} />
          </Pressable>
          <Pressable onPress={() => void handleRefreshFromSource()} style={styles.iconBtn}>
            <RefreshCw size={18} color={mossColors.fg} strokeWidth={1.8} />
          </Pressable>
        </View>
      </View>

      <FlashList
        data={chapters}
        estimatedItemSize={64}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View style={styles.headerBlock}>
            <View style={styles.heroRow}>
              <NovelCover uri={novel.local_cover_path || novel.cover_url} title={novel.title} style={styles.cover} />
              <View style={styles.heroMeta}>
                <ThemedText variant="sectionTitle" numberOfLines={3}>
                  {novel.title}
                </ThemedText>
                <ThemedText variant="subhead" numberOfLines={1}>
                  {novel.author || 'Unknown Author'}
                </ThemedText>
                <ThemedText variant="mono">
                  {novel.plugin_id} · {novel.source_status || 'Ongoing'}
                </ThemedText>
                <View style={styles.heroBtns}>
                  <Button
                    title={novel.in_library ? 'In Library' : 'Add to Library'}
                    variant={novel.in_library ? 'good' : 'primary'}
                    size="sm"
                    onPress={async () => {
                      if (!db) return;
                      await libraryRepo.setInLibrary(db, novel.id, !novel.in_library);
                      await loadData();
                      await refreshLibrary();
                    }}
                  />
                  {resumeChapter ? (
                    <Button
                      title={resumeLabel}
                      size="sm"
                      onPress={() =>
                        router.push({ pathname: '/reader/[chapterId]', params: { chapterId: String(resumeChapter.id) } })
                      }
                    />
                  ) : null}
                </View>
              </View>
            </View>

            {novel.summary ? (
              <ThemedText variant="subhead" numberOfLines={4} style={styles.summary}>
                {novel.summary}
              </ThemedText>
            ) : null}

            {/* Reading Status (maps 1:1 to external trackers) */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
              {STATUSES.map((st) => (
                <Chip
                  key={st.id}
                  label={st.label}
                  active={novel.reading_status === st.id}
                  onPress={async () => {
                    if (!db) return;
                    await libraryRepo.setReadingStatus(db, novel.id, st.id);
                    await loadData();
                    await refreshLibrary();
                  }}
                />
              ))}
            </ScrollView>

            {/* Custom Labels (many-to-many, separate from reading status) */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
              {allShelves.map((s) => {
                const has = assignedShelves.some((a) => a.id === s.id);
                const tok =
                  labelPalette[(s.color_token as LabelColorToken) ?? 'terracotta'] ??
                  labelPalette.terracotta;
                return (
                  <Chip
                    key={s.id}
                    label={s.name}
                    dotColor={tok.dot}
                    active={has}
                    onPress={async () => {
                      await toggleNovelLabel(novel.id, s.id);
                      await loadData();
                    }}
                  />
                );
              })}
              <Pressable
                onPress={() => setLabelSheetOpen(true)}
                style={styles.addLabelPill}
              >
                <Plus size={13} color={mossColors.accent} strokeWidth={2.2} />
                <ThemedText variant="caption" style={{ color: mossColors.accent }}>
                  Label
                </ThemedText>
              </Pressable>
            </ScrollView>

            {/* Bulk Download Strip */}
            <View style={styles.bulkBox}>
              <View style={styles.bulkHeader}>
                <ThemedText variant="cardTitle">Offline Chapters + Illustrations</ThemedText>
                <Pressable onPress={() => setDescOrder((d) => !d)}>
                  <ThemedText variant="mono" style={{ color: mossColors.accent }}>
                    {descOrder ? 'Newest first' : 'Oldest first'}
                  </ThemedText>
                </Pressable>
              </View>
              <View style={styles.bulkBtns}>
                <Button title="Next 10" variant="secondary" size="sm" onPress={() => queueBatch('next10')} />
                <Button title="Next 50" variant="secondary" size="sm" onPress={() => queueBatch('next50')} />
                <Button title="All Unread" variant="secondary" size="sm" onPress={() => queueBatch('unread')} />
              </View>
            </View>

            <View style={styles.chCountHeader}>
              <Bookmark size={14} color={mossColors.muted} strokeWidth={1.8} />
              <ThemedText variant="mono">
                {chapters.length} chapters {refreshing ? '· refreshing…' : ''}
              </ThemedText>
            </View>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push({ pathname: '/reader/[chapterId]', params: { chapterId: String(item.id) } })}
            style={styles.chapterRow}
          >
            <View style={styles.chapterInfo}>
              <ThemedText
                variant="cardTitle"
                numberOfLines={1}
                style={item.is_read ? { color: mossColors.muted } : undefined}
              >
                {item.name}
              </ThemedText>
              <ThemedText variant="mono">
                Ch. {item.chapter_number}
                {item.read_progress_pct > 0 && item.read_progress_pct < 100
                  ? ` · ${Math.round(item.read_progress_pct)}%`
                  : ''}
                {item.is_downloaded ? ' · Offline' : ''}
              </ThemedText>
            </View>

            {item.is_downloaded ? (
              <View style={styles.chActions}>
                <CheckCircle2 size={16} color={mossColors.good} strokeWidth={1.8} />
                <Pressable
                  onPress={async () => {
                    await engine?.deleteChapterAssets(item.id);
                    await loadData();
                  }}
                  hitSlop={8}
                >
                  <Trash2 size={15} color={mossColors.muted} strokeWidth={1.8} />
                </Pressable>
              </View>
            ) : (
              <Pressable
                onPress={() => void enqueueDownloads(novel.id, novel.plugin_id, [item.id])}
                hitSlop={8}
                style={styles.smallDl}
              >
                <Download size={15} color={mossColors.fg} strokeWidth={1.8} />
              </Pressable>
            )}
          </Pressable>
        )}
      />

      <TrackerModalSheet
        visible={trackerOpen}
        novelTitle={novel.title}
        links={trackers}
        onClose={() => setTrackerOpen(false)}
        onOpenNovelUpdatesWebView={(q) =>
          router.push({
            pathname: '/webview',
            params: {
              mode: 'novelupdates',
              novelId: String(novel.id),
              url: `https://www.novelupdates.com/?s=${encodeURIComponent(q)}&post_type=seriesplans`,
            },
          })
        }
        onLinkSelected={async (item) => {
          if (!db) return;
          let remoteProgress = 0;
          let remoteVolume = 0;
          if (item.provider === 'anilist' || item.provider === 'mal') {
            const token = await trackerAuthStore.getToken(item.provider);
            if (token) {
              const live =
                item.provider === 'anilist'
                  ? await fetchAniListProgress(item.remoteId, token).catch(() => null)
                  : await fetchMalProgress(item.remoteId, token).catch(() => null);
              if (live) {
                remoteProgress = live.chapter;
                remoteVolume = live.volume;
              }
            }
          }
          await trackerRepo.upsertLink(db, {
            novelId: novel.id,
            provider: item.provider,
            remoteId: item.remoteId,
            remoteTitle: item.title,
            remoteUrl: item.url ?? null,
            status: novel.reading_status,
            lastChapterSynced: remoteProgress,
            volumeProgress: remoteVolume,
          });
          await loadData();
        }}
        onUnlink={async (provider) => {
          if (!db) return;
          await trackerRepo.removeLink(db, novel.id, provider);
          await loadData();
        }}
      />

      <LabelManagerSheet
        visible={labelSheetOpen}
        labels={allShelves}
        targetNovel={{
          id: novel.id,
          title: novel.title,
          assignedIds: assignedShelves.map((s) => s.id),
        }}
        onCreateLabel={createShelf}
        onDeleteLabel={deleteShelf}
        onToggleNovelLabel={async (nId, labelId) => {
          await toggleNovelLabel(nId, labelId);
          await loadData();
        }}
        onClose={() => setLabelSheetOpen(false)}
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
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  topActions: {
    flexDirection: 'row',
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
  listContent: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xxl,
  },
  headerBlock: {
    gap: spacing.smd,
    marginBottom: spacing.smd,
  },
  heroRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  cover: {
    width: 102,
    height: 148,
  },
  heroMeta: {
    flex: 1,
    gap: spacing.xs,
    justifyContent: 'center',
  },
  heroBtns: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  summary: {
    lineHeight: 20,
  },
  chipRow: {
    gap: spacing.sm,
    alignItems: 'center',
  },
  addLabelPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: spacing.xs + 3,
    paddingHorizontal: spacing.smd,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: mossColors.border,
    backgroundColor: mossColors.surface,
  },
  bulkBox: {
    padding: spacing.smd,
    borderRadius: radius.card,
    backgroundColor: mossColors.surface,
    gap: spacing.sm,
  },
  bulkHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  bulkBtns: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  chCountHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  chapterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingVertical: spacing.smd,
    borderBottomWidth: 1,
    borderBottomColor: mossColors.border,
  },
  chapterInfo: {
    flex: 1,
    gap: 2,
  },
  chActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.smd,
  },
  smallDl: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    backgroundColor: mossColors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { ArrowLeft, ChevronLeft, ChevronRight, SlidersHorizontal } from 'lucide-react-native';
import { fontFamilies, mossColors, radius, readerSurfaces, spacing } from '@/theme';
import { useAppStore } from '@/store/appStore';
import { chapterRepo } from '@/db/repositories/chapterRepo';
import { libraryRepo } from '@/db/repositories/libraryRepo';
import { historyRepo } from '@/db/repositories/historyRepo';
import { trackerRepo } from '@/db/repositories/trackerRepo';
import { getRuntimePlugin } from '@/services/pluginLoader';
import { readChapterBlocksFromDisk } from '@/downloads/storage';
import { parseChapterHtml, type ChapterBlock } from '@/reader/chapterParser';
import { createExpoSpeechDriver, TtsController, type TtsState } from '@/reader/ttsController';
import { syncTrackerProgress } from '@/trackers/syncService';
import { pushAniListProgress } from '@/trackers/anilist';
import { pushMalProgress } from '@/trackers/mal';
import { trackerAuthStore } from '@/services/trackerAuth';
import type { ChapterRow, NovelRow } from '@/db/types';
import { ThemedText } from '@/components/ThemedText';
import { ReaderSettingsSheet } from '@/components/ReaderSettingsSheet';
import { TtsDockedBar } from '@/components/TtsDockedBar';
import { IllustrationLightbox } from '@/components/IllustrationLightbox';

const TTS_RATES = [0.85, 1.0, 1.25, 1.5, 1.75];

export default function ReaderScreen() {
  const { chapterId } = useLocalSearchParams<{ chapterId: string }>();
  const currentId = Number(chapterId);
  const router = useRouter();

  const db = useAppStore((s) => s.db);
  const readerPrefs = useAppStore((s) => s.readerPrefs);
  const updateReaderPrefs = useAppStore((s) => s.updateReaderPrefs);
  const refreshLibrary = useAppStore((s) => s.refreshLibrary);

  const [chapter, setChapter] = useState<ChapterRow | null>(null);
  const [novel, setNovel] = useState<NovelRow | null>(null);
  const [adjacent, setAdjacent] = useState<{ prev: ChapterRow | null; next: ChapterRow | null }>({
    prev: null,
    next: null,
  });
  const [blocks, setBlocks] = useState<ChapterBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState<string | null>(null);

  const [chromeVisible, setChromeVisible] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<{ uri: string; alt?: string } | null>(null);

  const [ttsState, setTtsState] = useState<TtsState>({
    enabled: false, // Strictly OFF by default!
    playing: false,
    activeBlockIndex: null,
    rate: readerPrefs.ttsRate,
  });

  const scrollRef = useRef<ScrollView>(null);
  const blockYMap = useRef<Record<number, number>>({});
  const scrollYRef = useRef(0);
  const viewportHeightRef = useRef(600);
  const progressPctRef = useRef(0);
  const nextChapterRef = useRef<ChapterRow | null>(null);
  nextChapterRef.current = adjacent.next;

  const ttsRef = useRef<TtsController | null>(null);
  if (!ttsRef.current) {
    ttsRef.current = new TtsController(createExpoSpeechDriver(), {
      onStateChange: (next) => setTtsState(next),
      onActiveBlockChange: (idx) => {
        if (idx !== null && blockYMap.current[idx] !== undefined) {
          scrollRef.current?.scrollTo({
            y: Math.max(0, blockYMap.current[idx] - 90),
            animated: true,
          });
        }
      },
      onChapterComplete: () => {
        const nextCh = nextChapterRef.current;
        if (nextCh) {
          router.replace({ pathname: '/reader/[chapterId]', params: { chapterId: String(nextCh.id) } });
        }
      },
    });
  }

  useEffect(() => {
    ttsRef.current?.setRate(readerPrefs.ttsRate);
  }, [readerPrefs.ttsRate]);

  useEffect(() => {
    const keepOn = readerPrefs.keepScreenAwake || ttsState.playing;
    if (keepOn) {
      void activateKeepAwakeAsync('vellichor-reader');
    } else {
      void deactivateKeepAwake('vellichor-reader');
    }
    return () => {
      void deactivateKeepAwake('vellichor-reader');
    };
  }, [readerPrefs.keepScreenAwake, ttsState.playing]);

  useEffect(() => {
    const controller = ttsRef.current;
    return () => {
      controller?.dispose();
    };
  }, []);

  const syncTrackersOnFinish = useCallback(
    async (loadedNovel: NovelRow, loadedChapter: ChapterRow) => {
      if (!db) return;
      const links = await trackerRepo.listByNovel(db, loadedNovel.id);
      for (const link of links) {
        if (link.provider !== 'anilist' && link.provider !== 'mal') continue;
        const token = await trackerAuthStore.getToken(link.provider);
        if (!token) continue;
        const result = await syncTrackerProgress(db, {
          novelId: loadedNovel.id,
          provider: link.provider,
          localChapter: loadedChapter.chapter_number,
          pushRemote: (update) =>
            link.provider === 'anilist'
              ? pushAniListProgress(token, update)
              : pushMalProgress(token, update),
        });
        if (result.outcome === 'conflict') {
          Alert.alert(
            `${link.provider.toUpperCase()} Ahead of Local`,
            `Remote is at chapter ${result.remoteChapter}, local is at ${result.localEffective}. Keep local progress or overwrite remote?`,
            [
              { text: 'Keep Local', style: 'cancel' },
              {
                text: 'Overwrite Remote',
                onPress: () => {
                  void syncTrackerProgress(db, {
                    novelId: loadedNovel.id,
                    provider: link.provider,
                    localChapter: loadedChapter.chapter_number,
                    forceOverwrite: true,
                    pushRemote: (update) =>
                      link.provider === 'anilist'
                        ? pushAniListProgress(token, update)
                        : pushMalProgress(token, update),
                  });
                },
              },
            ]
          );
        }
      }
    },
    [db]
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!db || !Number.isFinite(currentId)) return;
      setLoading(true);
      setErrorText(null);
      blockYMap.current = {};
      try {
        const ch = await chapterRepo.getChapterById(db, currentId);
        if (!ch) throw new Error('Chapter not found');
        const [n, adj] = await Promise.all([
          libraryRepo.getNovelById(db, ch.novel_id),
          chapterRepo.getAdjacentChapters(db, ch.novel_id, ch.id),
        ]);
        if (!n) throw new Error('Novel not found');

        let parsed: ChapterBlock[] = [];
        if (ch.is_downloaded === 1 && ch.content_path) {
          const json = await readChapterBlocksFromDisk(ch.content_path);
          parsed = JSON.parse(json) as ChapterBlock[];
        } else {
          const plugin = await getRuntimePlugin(db, n.plugin_id);
          if (!plugin) throw new Error(`Extension "${n.plugin_id}" is not installed`);
          const html = await plugin.parseChapter(ch.path);
          parsed = parseChapterHtml(html, plugin.site || undefined);
        }

        if (cancelled) return;
        setChapter(ch);
        setNovel(n);
        setAdjacent(adj);
        setBlocks(parsed);
        ttsRef.current?.loadBlocks(parsed, ch.scroll_paragraph_idx || 0);

        await libraryRepo.touchLastRead(db, n.id);
        await historyRepo.recordSession(db, { novelId: n.id, chapterId: ch.id });
        void refreshLibrary();

        // Restore exact saved paragraph scroll offset once laid out
        if (ch.scroll_paragraph_idx > 0) {
          setTimeout(() => {
            const targetY = blockYMap.current[ch.scroll_paragraph_idx];
            if (targetY !== undefined) {
              scrollRef.current?.scrollTo({ y: targetY, animated: false });
            }
          }, 120);
        }
      } catch (err) {
        if (!cancelled) {
          setErrorText(err instanceof Error ? err.message : 'Unable to load chapter');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [db, currentId, refreshLibrary]);

  const persistProgress = useCallback(
    async (pct: number, paragraphIdx: number) => {
      if (!db || !chapter || !novel) return;
      const reachedEnd = pct >= 92;
      await chapterRepo.saveReadProgress(db, chapter.id, {
        isRead: reachedEnd || chapter.is_read === 1,
        readProgressPct: Math.max(chapter.read_progress_pct, pct),
        scrollParagraphIdx: paragraphIdx,
      });
      if (reachedEnd && chapter.is_read === 0) {
        setChapter({ ...chapter, is_read: 1, read_progress_pct: 100 });
        void syncTrackersOnFinish(novel, chapter);
        void refreshLibrary();
      }
    },
    [db, chapter, novel, syncTrackersOnFinish, refreshLibrary]
  );

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    scrollYRef.current = contentOffset.y;
    viewportHeightRef.current = layoutMeasurement.height;
    const maxScroll = Math.max(1, contentSize.height - layoutMeasurement.height);
    const pct = Math.min(100, Math.round((contentOffset.y / maxScroll) * 100));
    progressPctRef.current = pct;
  };

  const handleScrollEnd = () => {
    let closestIdx = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const [idxStr, y] of Object.entries(blockYMap.current)) {
      const dist = Math.abs(y - scrollYRef.current);
      if (dist < bestDist) {
        bestDist = dist;
        closestIdx = Number(idxStr);
      }
    }
    void persistProgress(progressPctRef.current, closestIdx);
  };

  const surface = readerSurfaces[readerPrefs.surface] ?? readerSurfaces.moss;
  const lineHeightPx = Math.round(readerPrefs.fontSize * readerPrefs.lineHeight);

  const paragraphLabel = useMemo(() => {
    if (ttsState.activeBlockIndex === null) return 'Ready to read aloud';
    return `Paragraph ${ttsState.activeBlockIndex + 1} of ${blocks.length}`;
  }, [ttsState.activeBlockIndex, blocks.length]);

  const handlePageTap = (locationY: number) => {
    const h = viewportHeightRef.current;
    if (readerPrefs.tapZonesEnabled && locationY > h * 0.72) {
      scrollRef.current?.scrollTo({ y: scrollYRef.current + h * 0.82, animated: true });
      return;
    }
    if (readerPrefs.tapZonesEnabled && locationY < h * 0.24) {
      scrollRef.current?.scrollTo({ y: Math.max(0, scrollYRef.current - h * 0.82), animated: true });
      return;
    }
    setChromeVisible((v) => !v);
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: surface.bg }]} edges={['top', 'bottom']}>
      {chromeVisible ? (
        <View style={[styles.topBar, { borderBottomColor: surface.border, backgroundColor: surface.bg }]}>
          <Pressable
            testID="reader-back-btn"
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={() => router.back()}
            hitSlop={8}
            style={styles.iconBtn}
          >
            <ArrowLeft size={19} color={surface.fg} strokeWidth={1.8} />
          </Pressable>

          <View style={styles.topTitle}>
            <ThemedText variant="caption" style={{ color: surface.muted }} numberOfLines={1}>
              {novel?.title || 'Vellichor'}
            </ThemedText>
            <ThemedText variant="cardTitle" style={{ color: surface.fg }} numberOfLines={1}>
              {chapter?.name || 'Loading chapter…'}
            </ThemedText>
          </View>

          <Pressable
            testID="reader-settings-btn"
            accessibilityRole="button"
            accessibilityLabel="Reader settings and voice toggle"
            onPress={() => setSettingsOpen(true)}
            hitSlop={8}
            style={styles.iconBtn}
          >
            <SlidersHorizontal size={18} color={surface.fg} strokeWidth={1.8} />
          </Pressable>
        </View>
      ) : null}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={surface.accent} />
        </View>
      ) : errorText ? (
        <View style={styles.center}>
          <ThemedText variant="body" style={{ color: surface.fg, textAlign: 'center' }}>
            {errorText}
          </ThemedText>
        </View>
      ) : (
        <ScrollView
          ref={scrollRef}
          style={styles.scroll}
          contentContainerStyle={[
            styles.proseContainer,
            { paddingHorizontal: readerPrefs.horizontalMargin },
          ]}
          onScroll={handleScroll}
          onMomentumScrollEnd={handleScrollEnd}
          onScrollEndDrag={handleScrollEnd}
          scrollEventThrottle={32}
        >
          <Pressable onPress={(e) => handlePageTap(e.nativeEvent.locationY)}>
            {chapter ? (
              <ThemedText variant="sectionTitle" style={[styles.chapterHeading, { color: surface.fg }]}>
                {chapter.name}
              </ThemedText>
            ) : null}

            {blocks.map((block, idx) => {
              const isSpoken = ttsState.enabled && ttsState.activeBlockIndex === idx;
              return (
                <View
                  key={idx}
                  onLayout={(ev) => {
                    blockYMap.current[idx] = ev.nativeEvent.layout.y;
                  }}
                  style={isSpoken ? [styles.spokenWrap, { backgroundColor: surface.spokenTint }] : undefined}
                >
                  {block.type === 'heading' ? (
                    <ThemedText
                      style={[
                        styles.inlineHeading,
                        { color: surface.fg, fontSize: readerPrefs.fontSize + 3 },
                      ]}
                    >
                      {block.text}
                    </ThemedText>
                  ) : block.type === 'blockquote' ? (
                    <View style={[styles.quoteBox, { borderLeftColor: surface.accent }]}>
                      <ThemedText
                        style={{
                          fontFamily: fontFamilies.displayItalic,
                          fontSize: readerPrefs.fontSize,
                          lineHeight: lineHeightPx,
                          color: surface.muted,
                        }}
                      >
                        {block.text}
                      </ThemedText>
                    </View>
                  ) : block.type === 'divider' ? (
                    <View style={[styles.divider, { backgroundColor: surface.border }]} />
                  ) : block.type === 'image' ? (
                    <Pressable
                      testID={`chapter-illustration-${idx}`}
                      onPress={() => setLightboxImage({ uri: block.uri, alt: block.alt })}
                      style={styles.illustWrap}
                    >
                      <Image source={{ uri: block.uri }} style={styles.illustImage} contentFit="contain" />
                      {block.alt ? (
                        <ThemedText variant="caption" style={{ color: surface.muted, textAlign: 'center' }}>
                          {block.alt}
                        </ThemedText>
                      ) : null}
                    </Pressable>
                  ) : (
                    <ThemedText
                      style={[
                        styles.paragraph,
                        {
                          color: surface.fg,
                          fontSize: readerPrefs.fontSize,
                          lineHeight: lineHeightPx,
                        },
                      ]}
                    >
                      {block.text}
                    </ThemedText>
                  )}
                </View>
              );
            })}

            <View style={styles.endNavRow}>
              <Pressable
                disabled={!adjacent.prev}
                onPress={() =>
                  adjacent.prev &&
                  router.replace({ pathname: '/reader/[chapterId]', params: { chapterId: String(adjacent.prev.id) } })
                }
                style={[styles.endNavBtn, { borderColor: surface.border, opacity: adjacent.prev ? 1 : 0.35 }]}
              >
                <ChevronLeft size={16} color={surface.fg} />
                <ThemedText variant="caption" style={{ color: surface.fg }}>
                  Previous
                </ThemedText>
              </Pressable>
              <Pressable
                disabled={!adjacent.next}
                onPress={() =>
                  adjacent.next &&
                  router.replace({ pathname: '/reader/[chapterId]', params: { chapterId: String(adjacent.next.id) } })
                }
                style={[styles.endNavBtn, { borderColor: surface.border, opacity: adjacent.next ? 1 : 0.35 }]}
              >
                <ThemedText variant="caption" style={{ color: surface.fg }}>
                  Next Chapter
                </ThemedText>
                <ChevronRight size={16} color={surface.fg} />
              </Pressable>
            </View>
          </Pressable>
        </ScrollView>
      )}

      {/* Docked TTS audio bar: ONLY renders when toggled ON in settings, cleanly BELOW scroll viewport! */}
      {ttsState.enabled ? (
        <TtsDockedBar
          palette={surface}
          playing={ttsState.playing}
          rate={ttsState.rate}
          paragraphLabel={paragraphLabel}
          onTogglePlay={() => (ttsState.playing ? ttsRef.current?.pause() : ttsRef.current?.play())}
          onPrev={() => ttsRef.current?.prevParagraph()}
          onNext={() => ttsRef.current?.nextParagraph()}
          onCycleRate={() => {
            const idx = TTS_RATES.indexOf(ttsState.rate);
            const nextRate = TTS_RATES[(idx + 1) % TTS_RATES.length];
            ttsRef.current?.setRate(nextRate);
            void updateReaderPrefs({ ttsRate: nextRate });
          }}
          onDisable={() => ttsRef.current?.setEnabled(false)}
        />
      ) : null}

      <ReaderSettingsSheet
        visible={settingsOpen}
        prefs={readerPrefs}
        ttsEnabled={ttsState.enabled}
        onToggleTts={(next) => ttsRef.current?.setEnabled(next)}
        onUpdatePrefs={(patch) => void updateReaderPrefs(patch)}
        onClose={() => setSettingsOpen(false)}
      />

      <IllustrationLightbox
        uri={lightboxImage?.uri ?? null}
        alt={lightboxImage?.alt}
        onClose={() => setLightboxImage(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.smd,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    gap: spacing.sm,
  },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topTitle: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  scroll: {
    flex: 1,
  },
  proseContainer: {
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  chapterHeading: {
    marginBottom: spacing.lg,
  },
  inlineHeading: {
    fontFamily: fontFamilies.displaySemiBold,
    marginTop: spacing.md,
    marginBottom: spacing.smd,
  },
  paragraph: {
    fontFamily: fontFamilies.displayRegular,
    marginBottom: spacing.md,
  },
  quoteBox: {
    borderLeftWidth: 3,
    paddingLeft: spacing.smd,
    marginBottom: spacing.md,
  },
  divider: {
    height: 1,
    width: '40%',
    alignSelf: 'center',
    marginVertical: spacing.lg,
  },
  spokenWrap: {
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xs,
    marginHorizontal: -spacing.sm,
  },
  illustWrap: {
    marginVertical: spacing.md,
    gap: spacing.xs,
    alignItems: 'center',
  },
  illustImage: {
    width: '100%',
    height: 320,
    borderRadius: radius.cover,
  },
  endNavRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.smd,
    marginTop: spacing.lg,
  },
  endNavBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.smd,
    borderRadius: radius.md,
    borderWidth: 1,
  },
});

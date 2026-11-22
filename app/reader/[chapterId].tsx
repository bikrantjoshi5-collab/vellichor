import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
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
import * as Speech from 'expo-speech';
import * as Haptics from 'expo-haptics';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { ArrowLeft, ChevronLeft, ChevronRight, SlidersHorizontal, Volume2 } from 'lucide-react-native';
import { fontFamilies, radius, readerSurfaces, spacing } from '@/theme';
import { useAppStore } from '@/store/appStore';
import { chapterRepo } from '@/db/repositories/chapterRepo';
import { libraryRepo } from '@/db/repositories/libraryRepo';
import { historyRepo } from '@/db/repositories/historyRepo';
import { trackerRepo } from '@/db/repositories/trackerRepo';
import { getRuntimePlugin } from '@/services/pluginLoader';
import { readChapterBlocksFromDisk } from '@/downloads/storage';
import { parseChapterHtml, type ChapterBlock } from '@/reader/chapterParser';
import { createExpoSpeechDriver, TtsController, type TtsState } from '@/reader/ttsController';
import {
  pickDefaultNaturalVoice,
  rankAndLabelVoices,
  TTS_SPEED_PRESETS,
} from '@/reader/voiceCatalog';
import { computeRestoreScrollY, findNearestParagraphIndex } from '@/reader/restorePosition';
import { syncTrackerProgress, pullRemoteProgressToLocal } from '@/trackers/syncService';
import { fetchAniListProgress, pushAniListProgress } from '@/trackers/anilist';
import { fetchMalProgress, pushMalProgress } from '@/trackers/mal';
import { trackerAuthStore } from '@/services/trackerAuth';
import type { ChapterRow, NovelRow } from '@/db/types';
import { ThemedText } from '@/components/ThemedText';
import { ReaderSettingsSheet } from '@/components/ReaderSettingsSheet';
import { TtsDockedBar } from '@/components/TtsDockedBar';
import { IllustrationLightbox } from '@/components/IllustrationLightbox';

const TTS_RATES = [...TTS_SPEED_PRESETS];

interface PendingRestoreState {
  savedOffsetY: number;
  savedPct: number;
  savedParagraphIdx: number;
  done: boolean;
}

export default function ReaderScreen() {
  const { chapterId, autoPlayTts } = useLocalSearchParams<{ chapterId: string; autoPlayTts?: string }>();
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
  const [pickingParagraph, setPickingParagraph] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<{ uri: string; alt?: string } | null>(null);
  const [brokenImages, setBrokenImages] = useState<Record<number, boolean>>({});
  const [progressPct, setProgressPct] = useState(0);

  const [ttsState, setTtsState] = useState<TtsState>({
    enabled: autoPlayTts === '1', // Strictly OFF by default; preserved ONLY on TTS chapter auto-advance
    playing: false,
    activeBlockIndex: null,
    rate: readerPrefs.ttsRate,
    pitch: readerPrefs.ttsPitch,
    voice: readerPrefs.ttsVoice,
  });

  const scrollRef = useRef<ScrollView>(null);
  const blockYMap = useRef<Record<number, number>>({});
  const scrollYRef = useRef(0);
  const contentHeightRef = useRef(0);
  const viewportHeightRef = useRef(600);
  const progressPctRef = useRef(0);
  const activeParagraphRef = useRef(0);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRestoreRef = useRef<PendingRestoreState | null>(null);
  const syncedChapterIdRef = useRef<number | null>(null);
  const nextChapterRef = useRef<ChapterRow | null>(null);
  const chapterRef = useRef<ChapterRow | null>(null);
  const novelRef = useRef<NovelRow | null>(null);
  const blocksLengthRef = useRef(0);
  const persistCompleteRef = useRef<() => Promise<void>>(async () => {});
  const flushSaveRef = useRef<() => void>(() => {});

  nextChapterRef.current = adjacent.next;
  chapterRef.current = chapter;
  novelRef.current = novel;
  blocksLengthRef.current = blocks.length;

  // Auto-upgrade to a crisp HD Natural Android voice on first run (never use blurry legacy default)
  useEffect(() => {
    void Speech.getAvailableVoicesAsync()
      .then((list) => {
        const ranked = rankAndLabelVoices(list, { includeAllLanguages: false, maxCount: 28 });
        const best = pickDefaultNaturalVoice(ranked, readerPrefs.ttsVoice);
        if (best && best.identifier !== readerPrefs.ttsVoice) {
          ttsRef.current?.setVoice(best.identifier);
          void updateReaderPrefs({ ttsVoice: best.identifier });
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persistProgress = useCallback(
    async (pct: number, paragraphIdx: number, offsetY: number) => {
      const ch = chapterRef.current;
      const nov = novelRef.current;
      if (!db || !ch || !nov) return;
      const cleanPct = Math.max(0, Math.min(100, Math.round(pct)));
      const reachedEnd = cleanPct >= 92;
      await chapterRepo.saveReadProgress(db, ch.id, {
        isRead: reachedEnd || ch.is_read === 1,
        readProgressPct: cleanPct,
        scrollParagraphIdx: Math.max(0, paragraphIdx),
        scrollOffsetY: Math.max(0, Math.round(offsetY)),
      });
      if (reachedEnd && syncedChapterIdRef.current !== ch.id) {
        syncedChapterIdRef.current = ch.id;
        setChapter((prev) => (prev ? { ...prev, is_read: 1, read_progress_pct: 100 } : prev));
        void syncTrackersOnFinish(nov, ch);
        void refreshLibrary();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [db, refreshLibrary]
  );

  const flushCurrentPosition = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (!chapterRef.current) return;
    const nearestIdx =
      ttsRef.current?.getState().enabled && ttsRef.current.getState().activeBlockIndex !== null
        ? ttsRef.current.getState().activeBlockIndex!
        : findNearestParagraphIndex(blockYMap.current, scrollYRef.current);
    activeParagraphRef.current = nearestIdx;
    void persistProgress(progressPctRef.current, nearestIdx, scrollYRef.current);
  }, [persistProgress]);

  flushSaveRef.current = flushCurrentPosition;

  const ttsRef = useRef<TtsController | null>(null);
  if (!ttsRef.current) {
    ttsRef.current = new TtsController(createExpoSpeechDriver(), {
      onStateChange: (next) => {
        setTtsState(next);
        if (!next.enabled) setPickingParagraph(false);
        // Immediately persist exact position when pausing or turning off TTS
        if (!next.playing && next.activeBlockIndex !== null) {
          activeParagraphRef.current = next.activeBlockIndex;
          flushSaveRef.current();
        }
      },
      onActiveBlockChange: (idx) => {
        if (idx === null) return;
        activeParagraphRef.current = idx;
        const targetY = blockYMap.current[idx];
        if (targetY !== undefined) {
          const scrollTarget = Math.max(0, targetY - 84);
          scrollYRef.current = scrollTarget;
          scrollRef.current?.scrollTo({ y: scrollTarget, animated: true });
          const maxScroll = Math.max(1, contentHeightRef.current - viewportHeightRef.current);
          const pct = Math.min(100, Math.round((scrollTarget / maxScroll) * 100));
          progressPctRef.current = pct;
          setProgressPct(pct);
        } else if (blocksLengthRef.current > 1) {
          const pct = Math.min(100, Math.round((idx / (blocksLengthRef.current - 1)) * 100));
          progressPctRef.current = pct;
          setProgressPct(pct);
        }
        // Persist exact paragraph & percentage as TTS reads so quitting midway resumes EXACTLY here
        flushSaveRef.current();
      },
      onChapterComplete: () => {
        void persistCompleteRef.current().then(() => {
          const nextCh = nextChapterRef.current;
          if (nextCh) {
            router.replace({
              pathname: '/reader/[chapterId]',
              params: { chapterId: String(nextCh.id), autoPlayTts: '1' },
            });
          }
        });
      },
    });
  }

  useEffect(() => {
    ttsRef.current?.setRate(readerPrefs.ttsRate);
    ttsRef.current?.setPitch(readerPrefs.ttsPitch);
    ttsRef.current?.setVoice(readerPrefs.ttsVoice);
  }, [readerPrefs.ttsRate, readerPrefs.ttsPitch, readerPrefs.ttsVoice]);

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

  // Save exact reading / listening position immediately whenever app goes to background or closes
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'background' || nextState === 'inactive') {
        flushSaveRef.current();
      }
    });
    const controller = ttsRef.current;
    return () => {
      sub.remove();
      flushSaveRef.current();
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
          fetchRemoteChapter: async () => {
            const remote =
              link.provider === 'anilist'
                ? await fetchAniListProgress(link.remote_id, token)
                : await fetchMalProgress(link.remote_id, token);
            return remote?.chapter ?? null;
          },
          pushRemote: (update) =>
            link.provider === 'anilist'
              ? pushAniListProgress(token, update)
              : pushMalProgress(token, update),
        });
        if (result.outcome === 'conflict' && result.remoteChapter !== undefined) {
          const remoteCh = result.remoteChapter;
          Alert.alert(
            `${link.provider.toUpperCase()} Ahead of Local`,
            `Remote is at chapter ${remoteCh}, local is at ${result.localEffective}.`,
            [
              {
                text: 'Pull Remote Progress',
                onPress: () => {
                  void pullRemoteProgressToLocal(db, loadedNovel.id, link.provider, remoteCh).then(() =>
                    refreshLibrary()
                  );
                },
              },
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
    [db, refreshLibrary]
  );

  // Deterministically restores exact pixel/percentage/paragraph once content layout settles
  const tryRestoreScroll = useCallback(() => {
    const pending = pendingRestoreRef.current;
    if (!pending || pending.done) return;
    if (contentHeightRef.current <= viewportHeightRef.current) return;

    // Wait for target paragraph measurement if we have a saved paragraph and map is still populating
    if (
      pending.savedParagraphIdx > 0 &&
      blockYMap.current[pending.savedParagraphIdx] === undefined &&
      Object.keys(blockYMap.current).length < Math.min(blocksLengthRef.current, pending.savedParagraphIdx + 1)
    ) {
      return;
    }

    const targetY = computeRestoreScrollY({
      savedOffsetY: pending.savedOffsetY,
      savedPct: pending.savedPct,
      savedParagraphIdx: pending.savedParagraphIdx,
      blockYMap: blockYMap.current,
      contentHeight: contentHeightRef.current,
      viewportHeight: viewportHeightRef.current,
    });

    pending.done = true;
    scrollYRef.current = targetY;
    scrollRef.current?.scrollTo({ y: targetY, animated: false });
    const maxScroll = Math.max(1, contentHeightRef.current - viewportHeightRef.current);
    const exactPct = pending.savedPct > 0 ? Math.round(pending.savedPct) : Math.round((targetY / maxScroll) * 100);
    progressPctRef.current = exactPct;
    setProgressPct(exactPct);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!db || !Number.isFinite(currentId)) return;
      // Save any outgoing chapter before switching
      if (chapterRef.current && chapterRef.current.id !== currentId) {
        flushSaveRef.current();
      }
      setLoading(true);
      setErrorText(null);
      setPickingParagraph(false);
      blockYMap.current = {};
      contentHeightRef.current = 0;
      scrollYRef.current = 0;
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
        const savedPct = ch.read_progress_pct || 0;
        const savedParagraph = ch.scroll_paragraph_idx || 0;
        const savedOffsetY = ch.scroll_offset_y || 0;

        setChapter(ch);
        setNovel(n);
        setAdjacent(adj);
        setBlocks(parsed);
        setBrokenImages({});
        progressPctRef.current = Math.round(savedPct);
        setProgressPct(Math.round(savedPct));
        activeParagraphRef.current = savedParagraph;
        syncedChapterIdRef.current = ch.is_read === 1 ? ch.id : null;

        pendingRestoreRef.current =
          savedOffsetY > 0 || savedPct > 0 || savedParagraph > 0
            ? {
                savedOffsetY,
                savedPct,
                savedParagraphIdx: savedParagraph,
                done: false,
              }
            : null;

        ttsRef.current?.loadBlocks(parsed, savedParagraph);
        if (autoPlayTts === '1') {
          ttsRef.current?.setEnabled(true);
          ttsRef.current?.play(0);
        }

        await chapterRepo.touchChapterOpened(db, ch.id);
        await libraryRepo.touchLastRead(db, n.id);
        await historyRepo.recordSession(db, { novelId: n.id, chapterId: ch.id });
        void refreshLibrary();
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
  }, [db, currentId, autoPlayTts, refreshLibrary]);

  persistCompleteRef.current = async () => {
    await persistProgress(100, Math.max(0, blocks.length - 1), contentHeightRef.current);
  };

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    scrollYRef.current = contentOffset.y;
    contentHeightRef.current = contentSize.height;
    viewportHeightRef.current = layoutMeasurement.height;
    const maxScroll = Math.max(1, contentSize.height - layoutMeasurement.height);
    const pct = Math.min(100, Math.round((contentOffset.y / maxScroll) * 100));
    if (pct !== progressPctRef.current) {
      progressPctRef.current = pct;
      setProgressPct(pct);
    }
    // Debounced auto-save while scrolling so even force-closing mid-scroll keeps exact position
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const closestIdx = findNearestParagraphIndex(blockYMap.current, scrollYRef.current);
      activeParagraphRef.current = closestIdx;
      void persistProgress(progressPctRef.current, closestIdx, scrollYRef.current);
    }, 550);
  };

  const handleScrollEnd = () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const closestIdx = findNearestParagraphIndex(blockYMap.current, scrollYRef.current);
    activeParagraphRef.current = closestIdx;
    void persistProgress(progressPctRef.current, closestIdx, scrollYRef.current);
  };

  const handleStartVoiceFromParagraph = useCallback((idx: number) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setPickingParagraph(false);
    ttsRef.current?.jumpToParagraph(idx, true);
  }, []);

  const surface = readerSurfaces[readerPrefs.surface] ?? readerSurfaces.moss;
  const lineHeightPx = Math.round(readerPrefs.fontSize * readerPrefs.lineHeight);

  const paragraphLabel = useMemo(() => {
    if (ttsState.activeBlockIndex === null) return 'Long-press any paragraph to start';
    return `Paragraph ${ttsState.activeBlockIndex + 1} of ${blocks.length}`;
  }, [ttsState.activeBlockIndex, blocks.length]);

  const handlePageTap = (docLocationY: number) => {
    if (pickingParagraph) return;
    const h = viewportHeightRef.current;
    // Subtract scroll offset so tap zones stay viewport-relative even deep inside long chapters!
    const viewportY = Math.max(0, docLocationY - scrollYRef.current);
    if (readerPrefs.tapZonesEnabled && viewportY > h * 0.72) {
      scrollRef.current?.scrollTo({ y: scrollYRef.current + h * 0.82, animated: true });
      return;
    }
    if (readerPrefs.tapZonesEnabled && viewportY < h * 0.24) {
      scrollRef.current?.scrollTo({ y: Math.max(0, scrollYRef.current - h * 0.82), animated: true });
      return;
    }
    setChromeVisible((v) => !v);
  };

  const navigateBackSafely = () => {
    flushSaveRef.current();
    router.back();
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: surface.bg }]} edges={['top', 'bottom']}>
      {chromeVisible ? (
        <View style={[styles.topBar, { borderBottomColor: surface.border, backgroundColor: surface.bg }]}>
          <Pressable
            testID="reader-back-btn"
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={navigateBackSafely}
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

      {/* Clear inline banner when choosing which paragraph to start Voice narration from */}
      {pickingParagraph ? (
        <View style={[styles.pickBanner, { backgroundColor: surface.accent }]}>
          <ThemedText variant="caption" style={{ color: surface.accentFg, flex: 1 }}>
            Tap any paragraph below to start voice narration from there
          </ThemedText>
          <Pressable onPress={() => setPickingParagraph(false)} hitSlop={8}>
            <ThemedText variant="caption" style={{ color: surface.accentFg, fontFamily: fontFamilies.uiSemiBold }}>
              Cancel
            </ThemedText>
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
          onLayout={(ev) => {
            viewportHeightRef.current = ev.nativeEvent.layout.height;
            tryRestoreScroll();
          }}
          onContentSizeChange={(_w, h) => {
            contentHeightRef.current = h;
            tryRestoreScroll();
          }}
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
              const isSpeakable =
                block.type === 'paragraph' || block.type === 'heading' || block.type === 'blockquote';

              return (
                <View
                  key={idx}
                  onLayout={(ev) => {
                    blockYMap.current[idx] = ev.nativeEvent.layout.y;
                    tryRestoreScroll();
                  }}
                  style={[
                    isSpoken && [styles.spokenWrap, { backgroundColor: surface.spokenTint }],
                    pickingParagraph && isSpeakable && [styles.pickableWrap, { borderColor: surface.border }],
                  ]}
                >
                  {block.type === 'heading' ? (
                    <Pressable
                      onPress={
                        pickingParagraph ? () => handleStartVoiceFromParagraph(idx) : undefined
                      }
                      onLongPress={() => handleStartVoiceFromParagraph(idx)}
                      delayLongPress={360}
                    >
                      <ThemedText
                        style={[
                          styles.inlineHeading,
                          { color: surface.fg, fontSize: readerPrefs.fontSize + 3 },
                        ]}
                      >
                        {block.text}
                      </ThemedText>
                    </Pressable>
                  ) : block.type === 'blockquote' ? (
                    <Pressable
                      onPress={
                        pickingParagraph ? () => handleStartVoiceFromParagraph(idx) : undefined
                      }
                      onLongPress={() => handleStartVoiceFromParagraph(idx)}
                      delayLongPress={360}
                    >
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
                    </Pressable>
                  ) : block.type === 'divider' ? (
                    <View style={[styles.divider, { backgroundColor: surface.border }]} />
                  ) : block.type === 'image' ? (
                    <Pressable
                      testID={`chapter-illustration-${idx}`}
                      onPress={() => !brokenImages[idx] && setLightboxImage({ uri: block.uri, alt: block.alt })}
                      style={styles.illustWrap}
                    >
                      {brokenImages[idx] ? (
                        <View
                          style={[
                            styles.illustError,
                            { borderColor: surface.border, backgroundColor: surface.surface },
                          ]}
                        >
                          <ThemedText variant="caption" style={{ color: surface.muted }}>
                            Illustration unavailable offline
                          </ThemedText>
                        </View>
                      ) : (
                        <Image
                          source={{ uri: block.uri }}
                          cachePolicy="memory-disk"
                          style={styles.illustImage}
                          contentFit="contain"
                          onError={() => setBrokenImages((prev) => ({ ...prev, [idx]: true }))}
                        />
                      )}
                      {block.alt ? (
                        <ThemedText variant="caption" style={{ color: surface.muted, textAlign: 'center' }}>
                          {block.alt}
                        </ThemedText>
                      ) : null}
                    </Pressable>
                  ) : (
                    <Pressable
                      onPress={
                        pickingParagraph ? () => handleStartVoiceFromParagraph(idx) : undefined
                      }
                      onLongPress={() => handleStartVoiceFromParagraph(idx)}
                      delayLongPress={360}
                    >
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
                    </Pressable>
                  )}
                </View>
              );
            })}

            <View style={styles.endNavRow}>
              <Pressable
                disabled={!adjacent.prev}
                onPress={() => {
                  if (!adjacent.prev) return;
                  flushSaveRef.current();
                  router.replace({
                    pathname: '/reader/[chapterId]',
                    params: { chapterId: String(adjacent.prev.id) },
                  });
                }}
                style={[styles.endNavBtn, { borderColor: surface.border, opacity: adjacent.prev ? 1 : 0.35 }]}
              >
                <ChevronLeft size={16} color={surface.fg} />
                <ThemedText variant="caption" style={{ color: surface.fg }}>
                  Previous
                </ThemedText>
              </Pressable>
              <Pressable
                disabled={!adjacent.next}
                onPress={() => {
                  if (!adjacent.next) return;
                  flushSaveRef.current();
                  router.replace({
                    pathname: '/reader/[chapterId]',
                    params: { chapterId: String(adjacent.next.id) },
                  });
                }}
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

      {/* Clean bottom chapter navigation & progress bar when reader chrome is toggled visible */}
      {chromeVisible && !loading && !errorText && !ttsState.enabled ? (
        <View
          testID="reader-bottom-bar"
          style={[
            styles.bottomBar,
            { backgroundColor: surface.surface, borderTopColor: surface.border },
          ]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Previous chapter"
            disabled={!adjacent.prev}
            onPress={() => {
              if (!adjacent.prev) return;
              flushSaveRef.current();
              router.replace({
                pathname: '/reader/[chapterId]',
                params: { chapterId: String(adjacent.prev.id) },
              });
            }}
            hitSlop={8}
            style={[styles.bottomNavBtn, !adjacent.prev && styles.bottomNavDisabled]}
          >
            <ChevronLeft size={18} color={surface.fg} strokeWidth={1.8} />
            <ThemedText variant="caption" style={{ color: surface.fg }}>
              Prev
            </ThemedText>
          </Pressable>

          <View style={styles.bottomCenter}>
            <ThemedText variant="mono" style={{ color: surface.fg }}>
              {chapter ? `Ch. ${chapter.chapter_number}` : ''} · {progressPct}%
            </ThemedText>
          </View>

          <View style={styles.bottomRight}>
            <Pressable
              testID="reader-voice-quick-btn"
              accessibilityRole="button"
              accessibilityLabel="Open voice and reading speed settings"
              onPress={() => setSettingsOpen(true)}
              hitSlop={6}
              style={[styles.voiceQuickPill, { borderColor: surface.border }]}
            >
              <Volume2 size={14} color={surface.muted} strokeWidth={1.8} />
              <ThemedText variant="mono" style={{ color: surface.muted }}>
                {readerPrefs.ttsRate.toFixed(2).replace(/\.00$/, '.0')}x
              </ThemedText>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Next chapter"
              disabled={!adjacent.next}
              onPress={() => {
                if (!adjacent.next) return;
                flushSaveRef.current();
                router.replace({
                  pathname: '/reader/[chapterId]',
                  params: { chapterId: String(adjacent.next.id) },
                });
              }}
              hitSlop={8}
              style={[styles.bottomNavBtn, !adjacent.next && styles.bottomNavDisabled]}
            >
              <ThemedText variant="caption" style={{ color: surface.fg }}>
                Next
              </ThemedText>
              <ChevronRight size={18} color={surface.fg} strokeWidth={1.8} />
            </Pressable>
          </View>
        </View>
      ) : null}

      {/* Docked TTS audio bar: ONLY renders when toggled ON, cleanly BELOW scroll viewport */}
      {ttsState.enabled ? (
        <TtsDockedBar
          palette={surface}
          playing={ttsState.playing}
          rate={ttsState.rate}
          paragraphLabel={paragraphLabel}
          pickingParagraph={pickingParagraph}
          onTogglePickParagraph={() => setPickingParagraph((v) => !v)}
          onTogglePlay={() => (ttsState.playing ? ttsRef.current?.pause() : ttsRef.current?.play())}
          onPrev={() => ttsRef.current?.prevParagraph()}
          onNext={() => ttsRef.current?.nextParagraph()}
          onCycleRate={() => {
            const idx = TTS_RATES.findIndex((r) => Math.abs(r - ttsState.rate) < 0.02);
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
        onToggleTts={(next) => {
          if (next) {
            const nearest = findNearestParagraphIndex(blockYMap.current, scrollYRef.current);
            ttsRef.current?.jumpToParagraph(nearest, false);
          } else {
            ttsRef.current?.setEnabled(false);
          }
        }}
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
  pickBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
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
  pickableWrap: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xs,
    marginHorizontal: -spacing.sm,
    marginBottom: spacing.xs,
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
  illustError: {
    width: '100%',
    paddingVertical: spacing.lg,
    borderRadius: radius.cover,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
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
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderTopWidth: 1,
    gap: spacing.sm,
  },
  bottomNavBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  bottomNavDisabled: {
    opacity: 0.3,
  },
  bottomCenter: {
    flex: 1,
    alignItems: 'center',
  },
  bottomRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  voiceQuickPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    borderWidth: 1,
  },
});

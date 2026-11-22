import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { ExternalLink, Link2, Search, X } from 'lucide-react-native';
import { mossColors, radius, spacing } from '@/theme';
import type { TrackerLinkRow, TrackerProvider } from '@/db/types';
import { searchAniListNovels } from '@/trackers/anilist';
import { searchMalNovels } from '@/trackers/mal';
import { trackerAuthStore } from '@/services/trackerAuth';
import type { TrackerSearchItem } from '@/trackers/types';
import { ThemedText } from './ThemedText';
import { Button } from './Button';
import { Chip } from './Chip';

export interface TrackerModalSheetProps {
  visible: boolean;
  novelTitle: string;
  links: TrackerLinkRow[];
  onLinkSelected: (item: TrackerSearchItem) => Promise<void>;
  onOpenNovelUpdatesWebView: (query: string) => void;
  onUnlink: (provider: TrackerProvider) => Promise<void>;
  onClose: () => void;
}

export function TrackerModalSheet({
  visible,
  novelTitle,
  links,
  onLinkSelected,
  onOpenNovelUpdatesWebView,
  onUnlink,
  onClose,
}: TrackerModalSheetProps) {
  const [provider, setProvider] = useState<'anilist' | 'mal'>('anilist');
  const [query, setQuery] = useState(novelTitle);
  const [results, setResults] = useState<TrackerSearchItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const runSearch = async () => {
    setSearching(true);
    setErrorMsg(null);
    try {
      const token = await trackerAuthStore.getToken(provider);
      if (provider === 'mal' && !token) {
        setErrorMsg('Connect MyAnimeList in More → Trackers first.');
        setResults([]);
        return;
      }
      const list =
        provider === 'anilist'
          ? await searchAniListNovels(query, token)
          : await searchMalNovels(query, token!);
      setResults(list);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setSearching(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <ThemedText variant="sectionTitle">Track Novel</ThemedText>
            <Pressable onPress={onClose} style={styles.closeBtn}>
              <X size={18} color={mossColors.muted} strokeWidth={1.8} />
            </Pressable>
          </View>

          {links.length > 0 ? (
            <View style={styles.linkedBox}>
              {links.map((l) => (
                <View key={l.provider} style={styles.linkedRow}>
                  <View style={styles.linkedInfo}>
                    <ThemedText variant="cardTitle">{l.provider.toUpperCase()}</ThemedText>
                    <ThemedText variant="caption" numberOfLines={1}>
                      {l.remote_title} · Ch. {l.last_chapter_synced}
                    </ThemedText>
                  </View>
                  <Button
                    title="Unlink"
                    variant="ghost"
                    size="sm"
                    onPress={() => void onUnlink(l.provider)}
                  />
                </View>
              ))}
            </View>
          ) : null}

          <View style={styles.providerRow}>
            <Chip label="AniList" active={provider === 'anilist'} onPress={() => setProvider('anilist')} />
            <Chip label="MyAnimeList" active={provider === 'mal'} onPress={() => setProvider('mal')} />
            <Button
              title="NovelUpdates WebView"
              variant="secondary"
              size="sm"
              onPress={() => {
                onClose();
                onOpenNovelUpdatesWebView(query || novelTitle);
              }}
            />
          </View>

          <View style={styles.searchBar}>
            <Search size={16} color={mossColors.muted} strokeWidth={1.8} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search novel title..."
              placeholderTextColor={mossColors.muted}
              style={styles.input}
              onSubmitEditing={() => void runSearch()}
            />
            <Button title="Search" size="sm" loading={searching} onPress={() => void runSearch()} />
          </View>

          {errorMsg ? (
            <ThemedText variant="caption" style={{ color: mossColors.warn }}>
              {errorMsg}
            </ThemedText>
          ) : null}

          <ScrollView style={styles.resultsList} contentContainerStyle={styles.resultsContent}>
            {results.map((item) => (
              <View key={`${item.provider}-${item.remoteId}`} style={styles.resultRow}>
                <View style={styles.linkedInfo}>
                  <ThemedText variant="cardTitle" numberOfLines={2}>
                    {item.title}
                  </ThemedText>
                  <ThemedText variant="caption">
                    {item.totalVolumes ? `${item.totalVolumes} vols` : 'Light / Web Novel'}
                    {item.totalChapters ? ` · ${item.totalChapters} ch` : ''}
                  </ThemedText>
                </View>
                <Button
                  title="Link"
                  size="sm"
                  onPress={async () => {
                    await onLinkSelected(item);
                    onClose();
                  }}
                />
              </View>
            ))}
            {results.length === 0 && !searching ? (
              <View style={styles.hintRow}>
                <Link2 size={15} color={mossColors.muted} strokeWidth={1.75} />
                <ThemedText variant="caption">
                  Search AniList / MAL or tap NovelUpdates WebView to link this series.
                </ThemedText>
                <ExternalLink size={14} color={mossColors.muted} strokeWidth={1.75} />
              </View>
            ) : null}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: mossColors.backdrop,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: mossColors.bg,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    borderTopWidth: 1,
    borderColor: mossColors.border,
    padding: spacing.md,
    maxHeight: '85%',
    gap: spacing.smd,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: radius.full,
    backgroundColor: mossColors.border,
    alignSelf: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    backgroundColor: mossColors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkedBox: {
    backgroundColor: mossColors.surface,
    borderRadius: radius.md,
    padding: spacing.smd,
    gap: spacing.sm,
  },
  linkedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  linkedInfo: {
    flex: 1,
    gap: 2,
  },
  providerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: mossColors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.smd,
    paddingVertical: spacing.xs,
  },
  input: {
    flex: 1,
    color: mossColors.fg,
    fontSize: 14,
    paddingVertical: spacing.sm,
  },
  resultsList: {
    maxHeight: 280,
  },
  resultsContent: {
    gap: spacing.sm,
    paddingBottom: spacing.md,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    backgroundColor: mossColors.surface,
    padding: spacing.smd,
    borderRadius: radius.md,
  },
  hintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
});

import React from 'react';
import { Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { FlashList } from '@shopify/flash-list';
import { Bell, CheckCircle2, Download, RefreshCw } from 'lucide-react-native';
import dayjs from 'dayjs';
import { mossColors, radius, spacing } from '@/theme';
import { useAppStore } from '@/store/appStore';
import type { ChapterUpdateRow } from '@/db/types';
import { ThemedText } from '@/components/ThemedText';
import { NovelCover } from '@/components/NovelCover';
import { EmptyState } from '@/components/EmptyState';

export default function UpdatesScreen() {
  const router = useRouter();
  const updates = useAppStore((s) => s.updates);
  const checkingUpdates = useAppStore((s) => s.checkingUpdates);
  const updateCadence = useAppStore((s) => s.updateCadence);
  const checkUpdatesNow = useAppStore((s) => s.checkUpdatesNow);
  const enqueueDownloads = useAppStore((s) => s.enqueueDownloads);

  const renderItem = ({ item }: { item: ChapterUpdateRow }) => (
    <Pressable
      onPress={() => router.push({ pathname: '/reader/[chapterId]', params: { chapterId: String(item.id) } })}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.8 }]}
    >
      <NovelCover uri={item.novel_cover_url} title={item.novel_title} style={styles.thumb} />
      <View style={styles.info}>
        <ThemedText variant="cardTitle" numberOfLines={1}>
          {item.novel_title}
        </ThemedText>
        <ThemedText variant="subhead" numberOfLines={1}>
          {item.name}
        </ThemedText>
        <ThemedText variant="mono">
          Found {dayjs(item.discovered_at).format('MMM D')}
          {item.is_read ? ' · Read' : ''}
        </ThemedText>
      </View>

      {item.is_downloaded ? (
        <CheckCircle2 size={18} color={mossColors.good} strokeWidth={1.8} />
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Download ${item.name}`}
          onPress={() => void enqueueDownloads(item.novel_id, item.novel_plugin_id, [item.id])}
          hitSlop={8}
          style={styles.dlBtn}
        >
          <Download size={16} color={mossColors.fg} strokeWidth={1.8} />
        </Pressable>
      )}
    </Pressable>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <View>
          <ThemedText variant="screenTitle">Updates</ThemedText>
          <ThemedText variant="caption">
            Auto-check: {updateCadence === 'weekly' ? 'Once a week' : updateCadence === 'daily' ? 'Daily' : 'Manual only'}
          </ThemedText>
        </View>
        <Pressable
          testID="updates-refresh-btn"
          accessibilityRole="button"
          accessibilityLabel="Check for new chapters"
          onPress={() => void checkUpdatesNow()}
          style={styles.iconBtn}
        >
          <RefreshCw size={18} color={mossColors.fg} strokeWidth={1.8} />
        </Pressable>
      </View>

      {updates.length === 0 ? (
        <EmptyState
          icon={<Bell size={36} color={mossColors.muted} strokeWidth={1.5} />}
          title="No chapter updates yet"
          message="Pull to refresh anytime, or let Vellichor automatically check your library once a week."
          actionLabel="Check Now"
          onAction={() => void checkUpdatesNow()}
        />
      ) : (
        <FlashList
          data={updates}
          estimatedItemSize={82}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={checkingUpdates}
              onRefresh={() => void checkUpdatesNow()}
              tintColor={mossColors.accent}
            />
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
    paddingBottom: spacing.xl,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.smd,
    backgroundColor: mossColors.surface,
    borderRadius: radius.md,
    padding: spacing.smd,
    marginBottom: spacing.sm,
  },
  thumb: {
    width: 44,
    height: 62,
  },
  info: {
    flex: 1,
    gap: 2,
  },
  dlBtn: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    backgroundColor: mossColors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

import React, { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { FlashList } from '@shopify/flash-list';
import { AlertTriangle, ArrowLeft, CheckCircle2, Download, ShieldAlert } from 'lucide-react-native';
import { mossColors, radius, spacing } from '@/theme';
import { useAppStore } from '@/store/appStore';
import { downloadRepo } from '@/db/repositories/downloadRepo';
import type { DownloadJobRow } from '@/db/types';
import { ThemedText } from '@/components/ThemedText';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';

export default function QueueScreen() {
  const router = useRouter();
  const db = useAppStore((s) => s.db);
  const jobs = useAppStore((s) => s.downloadJobs);
  const plugins = useAppStore((s) => s.plugins);
  const pauseDownloads = useAppStore((s) => s.pauseDownloads);
  const resumeDownloads = useAppStore((s) => s.resumeDownloads);
  const retryFailedDownloads = useAppStore((s) => s.retryFailedDownloads);
  const refreshQueue = useAppStore((s) => s.refreshQueue);

  const summary = useMemo(() => {
    const active = jobs.filter((j) => j.status === 'pending' || j.status === 'running').length;
    const paused = jobs.filter((j) => j.status === 'paused').length;
    const failed = jobs.filter((j) => j.status === 'failed' || j.status === 'rate_limited').length;
    const cf = jobs.filter((j) => j.status === 'cf_required');
    const done = jobs.filter((j) => j.status === 'completed').length;
    return { active, paused, failed, cf, done };
  }, [jobs]);

  const renderJob = ({ item }: { item: DownloadJobRow }) => {
    const isCf = item.status === 'cf_required';
    const isWarn = item.status === 'rate_limited' || item.status === 'failed';
    const isDone = item.status === 'completed';

    return (
      <View style={styles.jobRow}>
        <View style={styles.jobMeta}>
          <ThemedText variant="cardTitle">
            {item.plugin_id} · Chapter #{item.chapter_id}
          </ThemedText>
          <ThemedText
            variant="mono"
            style={{
              color: isDone
                ? mossColors.good
                : isCf || isWarn
                ? mossColors.warn
                : mossColors.muted,
            }}
          >
            {item.status.toUpperCase()}
            {item.attempt_count > 0 ? ` · attempt ${item.attempt_count}` : ''}
          </ThemedText>
          {item.last_error ? (
            <ThemedText variant="caption" numberOfLines={2}>
              {item.last_error}
            </ThemedText>
          ) : null}
        </View>

        {isCf ? (
          <Button
            title="Clear CF"
            variant="warn"
            size="sm"
            onPress={() => {
              const site = plugins.find((p) => p.id === item.plugin_id)?.site || 'https://google.com';
              router.push({
                pathname: '/webview',
                params: { mode: 'cloudflare', pluginId: item.plugin_id, url: site },
              });
            }}
          />
        ) : isDone ? (
          <CheckCircle2 size={18} color={mossColors.good} strokeWidth={1.8} />
        ) : isWarn ? (
          <AlertTriangle size={18} color={mossColors.warn} strokeWidth={1.8} />
        ) : null}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn}>
          <ArrowLeft size={18} color={mossColors.fg} strokeWidth={1.8} />
        </Pressable>
        <ThemedText variant="sectionTitle" style={styles.title}>
          Download Queue
        </ThemedText>
        <View style={{ width: 38 }} />
      </View>

      <View style={styles.controlsPanel}>
        <ThemedText variant="mono">
          Active: {summary.active} · Retrying/Failed: {summary.failed} · Completed: {summary.done}
        </ThemedText>
        <View style={styles.btnRow}>
          {summary.paused > 0 ? (
            <Button title="Resume Queue" size="sm" onPress={() => void resumeDownloads()} />
          ) : (
            <Button title="Pause Queue" variant="secondary" size="sm" onPress={() => void pauseDownloads()} />
          )}
          <Button
            title="Retry Failed"
            variant={summary.failed > 0 ? 'warn' : 'ghost'}
            size="sm"
            onPress={() => void retryFailedDownloads()}
          />
          <Button
            title="Clear Done"
            variant="ghost"
            size="sm"
            onPress={async () => {
              if (!db) return;
              await downloadRepo.clearCompleted(db);
              await refreshQueue();
            }}
          />
        </View>
      </View>

      {summary.cf.length > 0 ? (
        <View style={styles.cfBanner}>
          <ShieldAlert size={18} color={mossColors.warn} strokeWidth={1.8} />
          <ThemedText variant="caption" style={{ flex: 1, color: mossColors.fg }}>
            {summary.cf.length} job(s) paused for Cloudflare check. Other sources continue downloading normally.
          </ThemedText>
        </View>
      ) : null}

      {jobs.length === 0 ? (
        <EmptyState
          icon={<Download size={36} color={mossColors.muted} strokeWidth={1.5} />}
          title="Queue is empty"
          message="Bulk chapter downloads (including offline light novel illustrations) will stream here safely with per-source rate limiting."
        />
      ) : (
        <FlashList
          data={jobs}
          estimatedItemSize={76}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderJob}
          contentContainerStyle={styles.listContent}
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
    justifyContent: 'space-between',
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
  title: {
    flex: 1,
    textAlign: 'center',
  },
  controlsPanel: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.smd,
    padding: spacing.smd,
    borderRadius: radius.card,
    backgroundColor: mossColors.surface,
    gap: spacing.sm,
  },
  btnRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  cfBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    marginBottom: spacing.smd,
    padding: spacing.smd,
    borderRadius: radius.md,
    backgroundColor: mossColors.warnSoft,
  },
  listContent: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xl,
  },
  jobRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    backgroundColor: mossColors.surface,
    padding: spacing.smd,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
  },
  jobMeta: {
    flex: 1,
    gap: 2,
  },
});

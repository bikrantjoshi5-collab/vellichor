import React, { useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  RefreshControl,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { FlashList } from '@shopify/flash-list';
import { Compass, Plus, RefreshCw, RotateCcw, Trash2 } from 'lucide-react-native';
import { mossColors, radius, spacing } from '@/theme';
import { useAppStore } from '@/store/appStore';
import { detectPluginUpdate } from '@/plugins/semver';
import type { PluginRow } from '@/db/types';
import { ThemedText } from '@/components/ThemedText';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';

export default function SourcesScreen() {
  const router = useRouter();
  const repos = useAppStore((s) => s.repos);
  const plugins = useAppStore((s) => s.plugins);
  const syncingRepos = useAppStore((s) => s.syncingRepos);
  const lastBannerMessage = useAppStore((s) => s.lastBannerMessage);
  const addRepoUrl = useAppStore((s) => s.addRepoUrl);
  const removeRepo = useAppStore((s) => s.removeRepo);
  const syncReposNow = useAppStore((s) => s.syncReposNow);
  const installPluginNow = useAppStore((s) => s.installPluginNow);
  const updateAllOutdatedPlugins = useAppStore((s) => s.updateAllOutdatedPlugins);
  const uninstallPlugin = useAppStore((s) => s.uninstallPlugin);

  const [repoInput, setRepoInput] = useState('');
  const [showAddRepo, setShowAddRepo] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [busyPluginId, setBusyPluginId] = useState<string | null>(null);

  const outdatedPlugins = useMemo(
    () =>
      plugins.filter(
        (p) =>
          p.installed === 1 &&
          detectPluginUpdate({
            installedVersion: p.version,
            remoteVersion: p.remote_version,
            installedHash: p.bundle_hash,
            remoteHash: p.remote_hash,
          }).hasUpdate
      ),
    [plugins]
  );

  const filteredPlugins = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return plugins;
    return plugins.filter(
      (p) => p.name.toLowerCase().includes(q) || p.lang.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)
    );
  }, [plugins, searchQuery]);

  const handleInstallOrUpdate = async (pluginId: string) => {
    setBusyPluginId(pluginId);
    try {
      await installPluginNow(pluginId);
    } catch (err) {
      Alert.alert('Extension Error', err instanceof Error ? err.message : 'Failed to install extension');
    } finally {
      setBusyPluginId(null);
    }
  };

  const renderPlugin = ({ item }: { item: PluginRow }) => {
    const updateCheck =
      item.installed === 1
        ? detectPluginUpdate({
            installedVersion: item.version,
            remoteVersion: item.remote_version,
            installedHash: item.bundle_hash,
            remoteHash: item.remote_hash,
          })
        : { hasUpdate: false, reason: 'none' as const };

    const isBusy = busyPluginId === item.id;

    return (
      <Pressable
        testID={`plugin-row-${item.id}`}
        onPress={() => {
          if (item.installed === 1) {
            router.push({ pathname: '/source/[pluginId]', params: { pluginId: item.id } });
          }
        }}
        style={styles.pluginCard}
      >
        <View style={styles.pluginBadge}>
          <ThemedText variant="mono" style={{ color: mossColors.fg }}>
            {item.name.slice(0, 2).toUpperCase()}
          </ThemedText>
        </View>

        <View style={styles.pluginMeta}>
          <ThemedText variant="cardTitle" numberOfLines={1}>
            {item.name}
          </ThemedText>
          <ThemedText variant="mono" numberOfLines={1}>
            {item.lang} ·{' '}
            {item.installed === 1
              ? updateCheck.hasUpdate
                ? `v${item.version} → v${item.remote_version}`
                : `v${item.version}`
              : `v${item.remote_version}`}
          </ThemedText>
        </View>

        <View style={styles.pluginActions}>
          {item.installed === 0 ? (
            <Button
              testID={`install-plugin-${item.id}`}
              title="Install"
              size="sm"
              loading={isBusy}
              onPress={() => void handleInstallOrUpdate(item.id)}
            />
          ) : updateCheck.hasUpdate ? (
            <Button
              testID={`update-plugin-${item.id}`}
              title="Update"
              variant="warn"
              size="sm"
              loading={isBusy}
              onPress={() => void handleInstallOrUpdate(item.id)}
            />
          ) : (
            <View style={styles.installedBtns}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Force re-fetch ${item.name}`}
                onPress={() => void handleInstallOrUpdate(item.id)}
                style={styles.smallIconBtn}
              >
                <RotateCcw size={14} color={mossColors.muted} strokeWidth={1.8} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Uninstall ${item.name}`}
                onPress={() => void uninstallPlugin(item.id)}
                style={styles.smallIconBtn}
              >
                <Trash2 size={14} color={mossColors.muted} strokeWidth={1.8} />
              </Pressable>
            </View>
          )}
        </View>
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <View>
          <ThemedText variant="screenTitle">Sources</ThemedText>
          <ThemedText variant="caption">
            {repos.length} GitHub repo(s) · {outdatedPlugins.length} update(s) ready
          </ThemedText>
        </View>
        <View style={styles.headerBtns}>
          <Pressable
            testID="sources-add-repo-btn"
            accessibilityRole="button"
            accessibilityLabel="Add GitHub plugin repository"
            onPress={() => setShowAddRepo((v) => !v)}
            style={styles.iconBtn}
          >
            <Plus size={18} color={mossColors.fg} strokeWidth={1.8} />
          </Pressable>
          <Pressable
            testID="sources-sync-btn"
            accessibilityRole="button"
            accessibilityLabel="Check GitHub repos for updates"
            onPress={() => void syncReposNow()}
            style={styles.iconBtn}
          >
            <RefreshCw size={18} color={mossColors.fg} strokeWidth={1.8} />
          </Pressable>
        </View>
      </View>

      {showAddRepo ? (
        <View style={styles.repoForm}>
          <ThemedText variant="caption">
            Paste any LNReader-compatible raw GitHub `plugins.min.json` URL:
          </ThemedText>
          <TextInput
            testID="repo-url-input"
            value={repoInput}
            onChangeText={setRepoInput}
            placeholder="https://raw.githubusercontent.com/.../plugins.min.json"
            placeholderTextColor={mossColors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />
          <View style={styles.repoFormRow}>
            <Button
              testID="repo-save-btn"
              title="Add & Sync Repo"
              size="sm"
              loading={syncingRepos}
              onPress={async () => {
                if (!repoInput.trim()) return;
                await addRepoUrl(repoInput.trim());
                setRepoInput('');
                setShowAddRepo(false);
              }}
            />
            <Button title="Cancel" variant="ghost" size="sm" onPress={() => setShowAddRepo(false)} />
          </View>
          {repos.length > 0 ? (
            <View style={styles.repoList}>
              {repos.map((r) => (
                <View key={r.id} style={styles.repoRow}>
                  <ThemedText variant="caption" numberOfLines={1} style={styles.repoName}>
                    {r.name}
                  </ThemedText>
                  <Pressable onPress={() => void removeRepo(r.id)} hitSlop={8}>
                    <Trash2 size={14} color={mossColors.danger} strokeWidth={1.8} />
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      {outdatedPlugins.length > 0 ? (
        <View style={styles.updateBanner}>
          <View style={styles.pluginMeta}>
            <ThemedText variant="cardTitle">
              {outdatedPlugins.length} extension update(s) found
            </ThemedText>
            <ThemedText variant="caption">Cache-busted directly from GitHub</ThemedText>
          </View>
          <Button
            testID="sources-update-all-btn"
            title="Update All"
            variant="warn"
            size="sm"
            onPress={() => void updateAllOutdatedPlugins()}
          />
        </View>
      ) : null}

      {lastBannerMessage ? (
        <ThemedText variant="caption" style={styles.bannerNote}>
          {lastBannerMessage}
        </ThemedText>
      ) : null}

      {plugins.length > 0 ? (
        <View style={styles.searchWrap}>
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search extensions by site or language..."
            placeholderTextColor={mossColors.muted}
            style={styles.input}
          />
        </View>
      ) : null}

      {plugins.length === 0 ? (
        <EmptyState
          icon={<Compass size={38} color={mossColors.accent} strokeWidth={1.5} />}
          title="No extensions connected yet"
          message="Tap + above to paste an LNReader GitHub plugins.min.json repository URL. Vellichor checks upstream cleanly with working one-tap updates."
          actionLabel="Add GitHub Repo"
          onAction={() => setShowAddRepo(true)}
        />
      ) : (
        <FlashList
          data={filteredPlugins}
          estimatedItemSize={72}
          keyExtractor={(item) => item.id}
          renderItem={renderPlugin}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={syncingRepos}
              onRefresh={() => void syncReposNow()}
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
  headerBtns: {
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
  repoForm: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.smd,
    padding: spacing.smd,
    borderRadius: radius.card,
    backgroundColor: mossColors.surface,
    gap: spacing.sm,
  },
  repoFormRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  repoList: {
    borderTopWidth: 1,
    borderTopColor: mossColors.border,
    paddingTop: spacing.sm,
    gap: spacing.xs,
  },
  repoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  repoName: {
    flex: 1,
    marginRight: spacing.sm,
  },
  updateBanner: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.smd,
    padding: spacing.smd,
    borderRadius: radius.card,
    backgroundColor: mossColors.surfaceElevated,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  bannerNote: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    color: mossColors.good,
  },
  searchWrap: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.smd,
  },
  input: {
    backgroundColor: mossColors.surfaceElevated,
    color: mossColors.fg,
    borderRadius: radius.md,
    paddingHorizontal: spacing.smd,
    paddingVertical: spacing.sm + 2,
    fontSize: 14,
  },
  listContent: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xl,
  },
  pluginCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.smd,
    backgroundColor: mossColors.surface,
    borderRadius: radius.md,
    padding: spacing.smd,
    marginBottom: spacing.sm,
  },
  pluginBadge: {
    width: 38,
    height: 38,
    borderRadius: radius.sm,
    backgroundColor: mossColors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pluginMeta: {
    flex: 1,
    gap: 2,
  },
  pluginActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  installedBtns: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  smallIconBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    backgroundColor: mossColors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

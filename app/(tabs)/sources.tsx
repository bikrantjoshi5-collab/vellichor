import React, { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import {
  Compass,
  Globe,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react-native';
import { mossColors, motion, radius, spacing } from '@/theme';
import { useAppStore } from '@/store/appStore';
import { detectPluginUpdate } from '@/plugins/semver';
import {
  discoverGitHubPluginRepos,
  isVerifiedRepoUrl,
  RECOMMENDED_REPOS,
  type RecommendedRepo,
} from '@/plugins/recommendedRepos';
import {
  searchAcrossInstalledPlugins,
  type GlobalSearchGroup,
} from '@/plugins/globalSearch';
import { getRuntimePlugin } from '@/services/pluginLoader';
import { libraryRepo } from '@/db/repositories/libraryRepo';
import { chapterRepo } from '@/db/repositories/chapterRepo';
import type { PluginInstance, PluginNovelItem } from '@/plugins/types';
import type { PluginRow } from '@/db/types';
import { ThemedText } from '@/components/ThemedText';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { ExtensionLogo } from '@/components/ExtensionLogo';
import { NovelCover } from '@/components/NovelCover';

type SourceTab = 'installed' | 'browse';

export default function SourcesScreen() {
  const router = useRouter();
  const db = useAppStore((s) => s.db);
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

  const [activeTab, setActiveTab] = useState<SourceTab>('installed');
  const [busyPluginId, setBusyPluginId] = useState<string | null>(null);

  // Installed tab: Ordered Global Novel Search across every installed source
  const [globalQuery, setGlobalQuery] = useState('');
  const [searchingGlobal, setSearchingGlobal] = useState(false);
  const [globalGroups, setGlobalGroups] = useState<GlobalSearchGroup[]>([]);
  const [openingKey, setOpeningKey] = useState<string | null>(null);
  const searchAbortRef = useRef<{ aborted: boolean } | null>(null);

  // Browse Repos tab: Recommended repos + GitHub repo discovery + extension filter
  const [repoInput, setRepoInput] = useState('');
  const [showCustomRepo, setShowCustomRepo] = useState(false);
  const [ghQuery, setGhQuery] = useState('');
  const [ghSearching, setGhSearching] = useState(false);
  const [discoveredRepos, setDiscoveredRepos] = useState<RecommendedRepo[]>([]);
  const [catalogFilter, setCatalogFilter] = useState('');

  const installedPlugins = useMemo(() => plugins.filter((p) => p.installed === 1), [plugins]);

  const outdatedPlugins = useMemo(
    () =>
      installedPlugins.filter(
        (p) =>
          detectPluginUpdate({
            installedVersion: p.version,
            remoteVersion: p.remote_version,
            installedHash: p.bundle_hash,
            installedManifestHash: p.installed_manifest_hash,
            remoteHash: p.remote_hash,
            installedEtag: p.installed_etag,
            remoteEtag: p.remote_etag,
          }).hasUpdate
      ),
    [installedPlugins]
  );

  const filteredCatalog = useMemo(() => {
    const q = catalogFilter.trim().toLowerCase();
    if (!q) return plugins;
    return plugins.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.lang.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q)
    );
  }, [plugins, catalogFilter]);

  const connectedRepoUrls = useMemo(() => new Set(repos.map((r) => r.url.trim())), [repos]);

  const confirmAndAddRepo = (url: string, name?: string) => {
    const cleanUrl = url.trim();
    if (!cleanUrl) return;
    if (isVerifiedRepoUrl(cleanUrl)) {
      void addRepoUrl(cleanUrl, name);
      return;
    }
    Alert.alert(
      'Unverified Repository Warning',
      `Extensions execute JavaScript inside Vellichor. GitHub stars can be faked, and this repository has not been audited.\n\nOnly add "${name || cleanUrl}" if you personally trust its author.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Add Anyway',
          style: 'destructive',
          onPress: () => {
            void addRepoUrl(cleanUrl, name);
          },
        },
      ]
    );
  };

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

  const handleRunGlobalSearch = async () => {
    if (!db || !globalQuery.trim()) return;
    if (installedPlugins.length === 0) {
      Alert.alert('No Installed Sources', 'Switch to Browse Repos and install at least one extension first.');
      return;
    }

    if (searchAbortRef.current) searchAbortRef.current.aborted = true;
    const signal = { aborted: false };
    searchAbortRef.current = signal;

    setSearchingGlobal(true);
    setGlobalGroups([]);

    try {
      const runtimeInstances: PluginInstance[] = [];
      const iconById: Record<string, string | null> = {};
      for (const row of installedPlugins) {
        iconById[row.id] = row.icon_url;
        try {
          const inst = await getRuntimePlugin(db, row.id);
          if (inst) runtimeInstances.push(inst);
        } catch {
          // Skip unloadable plugin without halting global search
        }
      }

      await searchAcrossInstalledPlugins(runtimeInstances, globalQuery.trim(), {
        iconById,
        signal,
        onGroupReady: (group) => {
          if (!signal.aborted) {
            setGlobalGroups((prev) => [...prev, group]);
          }
        },
      });
    } finally {
      if (!signal.aborted) setSearchingGlobal(false);
    }
  };

  const handleOpenSearchNovel = async (pluginId: string, novel: PluginNovelItem) => {
    if (!db) return;
    const key = `${pluginId}::${novel.path}`;
    setOpeningKey(key);
    try {
      const plugin = await getRuntimePlugin(db, pluginId);
      if (!plugin) throw new Error('Extension not installed');
      const parsed = await plugin.parseNovel(novel.path);
      const novelId = await libraryRepo.upsertNovel(db, {
        pluginId,
        path: novel.path,
        title: parsed.name || novel.name,
        author: parsed.author ?? null,
        coverUrl: parsed.cover || novel.cover || null,
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
      Alert.alert('Could Not Open Novel', err instanceof Error ? err.message : 'Parse failed');
    } finally {
      setOpeningKey(null);
    }
  };

  const handleDiscoverRepos = async () => {
    setGhSearching(true);
    try {
      const found = await discoverGitHubPluginRepos(ghQuery);
      setDiscoveredRepos(found);
      if (found.length === 0) {
        Alert.alert('No Manifests Found', 'No matching GitHub repositories had a valid plugins.min.json file.');
      }
    } catch (err) {
      Alert.alert('GitHub Search Failed', err instanceof Error ? err.message : 'Network error');
    } finally {
      setGhSearching(false);
    }
  };

  const renderPluginRow = ({ item }: { item: PluginRow }) => {
    const updateCheck =
      item.installed === 1
        ? detectPluginUpdate({
            installedVersion: item.version,
            remoteVersion: item.remote_version,
            installedHash: item.bundle_hash,
            installedManifestHash: item.installed_manifest_hash,
            remoteHash: item.remote_hash,
            installedEtag: item.installed_etag,
            remoteEtag: item.remote_etag,
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
        <ExtensionLogo uri={item.icon_url} name={item.name} size={40} />

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

  const showingGlobalResults = globalQuery.trim().length > 0 && (searchingGlobal || globalGroups.length > 0);
  const allRecommended = [...RECOMMENDED_REPOS, ...discoveredRepos.filter((d) => !RECOMMENDED_REPOS.some((r) => r.url === d.url))];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <View>
          <ThemedText variant="screenTitle">Sources</ThemedText>
          <ThemedText variant="caption">
            {installedPlugins.length} installed · {repos.length} repo(s)
            {outdatedPlugins.length > 0 ? ` · ${outdatedPlugins.length} update(s)` : ''}
          </ThemedText>
        </View>
        <View style={styles.headerBtns}>
          <Pressable
            testID="sources-add-repo-btn"
            accessibilityRole="button"
            accessibilityLabel="Add custom GitHub plugin repository"
            onPress={() => {
              setActiveTab('browse');
              setShowCustomRepo((v) => !v);
            }}
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

      {/* Two-option switcher: Installed vs Browse Repos */}
      <View style={styles.segmentedBar}>
        <Pressable
          testID="sources-tab-installed"
          onPress={() => setActiveTab('installed')}
          style={[styles.segBtn, activeTab === 'installed' && styles.segBtnActive]}
        >
          <ThemedText
            variant="cardTitle"
            style={{ color: activeTab === 'installed' ? mossColors.accentFg : mossColors.muted }}
          >
            Installed ({installedPlugins.length})
          </ThemedText>
        </Pressable>
        <Pressable
          testID="sources-tab-browse"
          onPress={() => setActiveTab('browse')}
          style={[styles.segBtn, activeTab === 'browse' && styles.segBtnActive]}
        >
          <ThemedText
            variant="cardTitle"
            style={{ color: activeTab === 'browse' ? mossColors.accentFg : mossColors.muted }}
          >
            Browse Repos ({plugins.length})
          </ThemedText>
        </Pressable>
      </View>

      {outdatedPlugins.length > 0 ? (
        <View style={styles.updateBanner}>
          <View style={styles.pluginMeta}>
            <ThemedText variant="cardTitle">{outdatedPlugins.length} extension update(s) ready</ThemedText>
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

      {activeTab === 'installed' ? (
        <View style={styles.tabBody}>
          {/* Ordered Global Novel Search across every installed source */}
          <View style={styles.globalSearchBar}>
            <Search size={16} color={mossColors.muted} strokeWidth={1.8} />
            <TextInput
              testID="sources-global-search-input"
              value={globalQuery}
              onChangeText={(t) => {
                setGlobalQuery(t);
                if (!t.trim()) {
                  if (searchAbortRef.current) searchAbortRef.current.aborted = true;
                  setSearchingGlobal(false);
                  setGlobalGroups([]);
                }
              }}
              placeholder="Search novel across all installed sites..."
              placeholderTextColor={mossColors.muted}
              style={styles.searchInput}
              returnKeyType="search"
              onSubmitEditing={() => void handleRunGlobalSearch()}
            />
            {globalQuery.length > 0 ? (
              <Pressable
                onPress={() => {
                  if (searchAbortRef.current) searchAbortRef.current.aborted = true;
                  setGlobalQuery('');
                  setSearchingGlobal(false);
                  setGlobalGroups([]);
                }}
                hitSlop={6}
              >
                <X size={16} color={mossColors.muted} strokeWidth={1.8} />
              </Pressable>
            ) : null}
            <Button
              testID="sources-global-search-btn"
              title="Search"
              size="sm"
              loading={searchingGlobal}
              onPress={() => void handleRunGlobalSearch()}
            />
          </View>

          {showingGlobalResults ? (
            <ScrollView
              contentContainerStyle={styles.globalResultsContent}
              showsVerticalScrollIndicator={false}
            >
              {searchingGlobal ? (
                <View style={styles.searchingRow}>
                  <ActivityIndicator size="small" color={mossColors.accent} />
                  <ThemedText variant="caption">
                    Searching {installedPlugins.length} site(s) in order ({globalGroups.length}/{installedPlugins.length} checked)…
                  </ThemedText>
                </View>
              ) : null}

              {globalGroups.map((group) => (
                <View key={group.pluginId} style={styles.searchGroup}>
                  <View style={styles.searchGroupHeader}>
                    <ExtensionLogo uri={group.iconUrl} name={group.pluginName} size={28} />
                    <ThemedText variant="cardTitle" style={{ flex: 1 }} numberOfLines={1}>
                      {group.pluginName}
                    </ThemedText>
                    <ThemedText
                      variant="mono"
                      style={{ color: group.error ? mossColors.warn : mossColors.muted }}
                    >
                      {group.error ? 'Error' : `${group.novels.length} found`}
                    </ThemedText>
                  </View>

                  {group.error ? (
                    <ThemedText variant="caption" style={{ color: mossColors.warn }}>
                      {group.error}
                    </ThemedText>
                  ) : group.novels.length === 0 ? (
                    <ThemedText variant="caption">No matches on this source.</ThemedText>
                  ) : (
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.groupCardsRow}
                    >
                      {group.novels.slice(0, 12).map((novel, idx) => {
                        const key = `${group.pluginId}::${novel.path}`;
                        return (
                          <Pressable
                            key={`${key}-${idx}`}
                            onPress={() => void handleOpenSearchNovel(group.pluginId, novel)}
                            style={({ pressed }) => [
                              styles.searchNovelCard,
                              pressed && { transform: [{ scale: motion.pressScale }] },
                            ]}
                          >
                            <NovelCover uri={novel.cover} title={novel.name} style={styles.searchNovelCover} />
                            <ThemedText variant="caption" style={{ color: mossColors.fg }} numberOfLines={2}>
                              {openingKey === key ? 'Opening…' : novel.name}
                            </ThemedText>
                          </Pressable>
                        );
                      })}
                    </ScrollView>
                  )}
                </View>
              ))}
            </ScrollView>
          ) : installedPlugins.length === 0 ? (
            <EmptyState
              icon={<Compass size={38} color={mossColors.accent} strokeWidth={1.5} />}
              title="No extensions installed yet"
              message="Open Browse Repos to add a recommended GitHub repository with one tap and install your favorite novel sites."
              actionLabel="Browse Repos"
              onAction={() => setActiveTab('browse')}
            />
          ) : (
            <FlashList
              data={installedPlugins}
              estimatedItemSize={74}
              keyExtractor={(item) => item.id}
              renderItem={renderPluginRow}
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
        </View>
      ) : (
        /* BROWSE REPOS TAB */
        <FlashList
          data={filteredCatalog}
          estimatedItemSize={74}
          keyExtractor={(item) => item.id}
          renderItem={renderPluginRow}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={syncingRepos}
              onRefresh={() => void syncReposNow()}
              tintColor={mossColors.accent}
            />
          }
          ListHeaderComponent={
            <View style={styles.browseHeader}>
              {/* Custom Repo URL Form */}
              {showCustomRepo ? (
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
                      onPress={() => {
                        if (!repoInput.trim()) return;
                        confirmAndAddRepo(repoInput.trim());
                        setRepoInput('');
                        setShowCustomRepo(false);
                      }}
                    />
                    <Button title="Cancel" variant="ghost" size="sm" onPress={() => setShowCustomRepo(false)} />
                  </View>
                </View>
              ) : null}

              {/* Recommended Repositories + GitHub Repo Discovery */}
              <View style={styles.recBox}>
                <View style={styles.recHeader}>
                  <Sparkles size={16} color={mossColors.accent} strokeWidth={1.8} />
                  <ThemedText variant="cardTitle" style={{ flex: 1 }}>
                    Recommended Repositories
                  </ThemedText>
                </View>

                {allRecommended.map((rec) => {
                  const isAdded = connectedRepoUrls.has(rec.url);
                  return (
                    <View key={rec.url} style={styles.recCard}>
                      <View style={{ flex: 1, gap: 2 }}>
                        <ThemedText variant="cardTitle" numberOfLines={1}>
                          {rec.name}
                        </ThemedText>
                        <ThemedText variant="caption" numberOfLines={2}>
                          {rec.description}
                        </ThemedText>
                        <ThemedText
                          variant="mono"
                          style={{ color: rec.verified ? mossColors.good : mossColors.warn }}
                        >
                          {rec.badge}
                        </ThemedText>
                      </View>
                      <Button
                        title={isAdded ? 'Added' : 'Add Repo'}
                        variant={isAdded ? 'good' : rec.verified ? 'primary' : 'secondary'}
                        size="sm"
                        disabled={isAdded}
                        loading={syncingRepos && !isAdded}
                        onPress={() => confirmAndAddRepo(rec.url, rec.name)}
                      />
                    </View>
                  );
                })}

                {/* Discover more LNReader repos live from GitHub */}
                <View style={styles.ghSearchRow}>
                  <Globe size={15} color={mossColors.muted} strokeWidth={1.8} />
                  <TextInput
                    value={ghQuery}
                    onChangeText={setGhQuery}
                    placeholder="Find more GitHub repos (e.g. spanish, arabic)..."
                    placeholderTextColor={mossColors.muted}
                    style={styles.searchInput}
                    onSubmitEditing={() => void handleDiscoverRepos()}
                  />
                  <Button
                    title="Find"
                    variant="secondary"
                    size="sm"
                    loading={ghSearching}
                    onPress={() => void handleDiscoverRepos()}
                  />
                </View>

                {repos.length > 0 ? (
                  <View style={styles.connectedRepos}>
                    <ThemedText variant="caption">Connected Repositories</ThemedText>
                    {repos.map((r) => (
                      <View key={r.id} style={styles.repoRow}>
                        <ThemedText variant="caption" style={{ flex: 1, color: mossColors.fg }} numberOfLines={1}>
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

              {plugins.length > 0 ? (
                <View style={styles.catalogSearchWrap}>
                  <ThemedText variant="sectionTitle">Available Extensions</ThemedText>
                  <TextInput
                    value={catalogFilter}
                    onChangeText={setCatalogFilter}
                    placeholder="Filter extensions by name or language (e.g. English, Royal)..."
                    placeholderTextColor={mossColors.muted}
                    style={styles.input}
                  />
                </View>
              ) : null}
            </View>
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
  segmentedBar: {
    flexDirection: 'row',
    marginHorizontal: spacing.md,
    marginBottom: spacing.smd,
    padding: 4,
    borderRadius: radius.md,
    backgroundColor: mossColors.surface,
    gap: 4,
  },
  segBtn: {
    flex: 1,
    paddingVertical: spacing.sm + 1,
    borderRadius: radius.sm + 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segBtnActive: {
    backgroundColor: mossColors.accent,
  },
  tabBody: {
    flex: 1,
  },
  globalSearchBar: {
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
  searchInput: {
    flex: 1,
    color: mossColors.fg,
    fontSize: 13.5,
    paddingVertical: spacing.sm,
  },
  searchingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingBottom: spacing.sm,
  },
  globalResultsContent: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  searchGroup: {
    backgroundColor: mossColors.surface,
    borderRadius: radius.card,
    padding: spacing.smd,
    gap: spacing.sm,
  },
  searchGroupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  groupCardsRow: {
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
  searchNovelCard: {
    width: 102,
    gap: spacing.xs,
  },
  searchNovelCover: {
    width: 102,
    height: 144,
  },
  browseHeader: {
    gap: spacing.md,
    marginBottom: spacing.smd,
  },
  repoForm: {
    padding: spacing.smd,
    borderRadius: radius.card,
    backgroundColor: mossColors.surface,
    gap: spacing.sm,
  },
  repoFormRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  recBox: {
    padding: spacing.smd,
    borderRadius: radius.card,
    backgroundColor: mossColors.surface,
    gap: spacing.sm,
  },
  recHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  recCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.smd,
    borderRadius: radius.md,
    backgroundColor: mossColors.surfaceElevated,
  },
  ghSearchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.smd,
    paddingVertical: spacing.xs,
    borderRadius: radius.md,
    backgroundColor: mossColors.surfaceElevated,
  },
  connectedRepos: {
    borderTopWidth: 1,
    borderTopColor: mossColors.border,
    paddingTop: spacing.sm,
    gap: spacing.xs,
  },
  repoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingVertical: 2,
  },
  catalogSearchWrap: {
    gap: spacing.sm,
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
    paddingBottom: spacing.xxl,
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

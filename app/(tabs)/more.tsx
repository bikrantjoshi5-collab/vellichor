import React, { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import * as Crypto from 'expo-crypto';
import {
  ArchiveRestore,
  ChevronRight,
  Clock,
  Download,
  FolderPlus,
  HardDriveDownload,
  Link2,
  Trash2,
} from 'lucide-react-native';
import { mossColors, radius, spacing } from '@/theme';
import { useAppStore } from '@/store/appStore';
import { exportMossBackup, importMossBackup } from '@/backup/mossBackup';
import { importLnReaderZip, previewLnReaderZip } from '@/backup/lnreaderImport';
import { trackerAuthStore } from '@/services/trackerAuth';
import { buildAniListImplicitAuthUrl, extractAniListTokenFromRedirect } from '@/trackers/anilist';
import { buildMalPkceAuthUrl, exchangeMalCodeForToken } from '@/trackers/mal';
import { historyRepo } from '@/db/repositories/historyRepo';
import type { ReadingHistoryRow } from '@/db/types';
import type { UpdateCadence } from '@/updates/updateScheduler';
import { ThemedText } from '@/components/ThemedText';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';

function base64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export default function MoreScreen() {
  const router = useRouter();
  const db = useAppStore((s) => s.db);
  const shelves = useAppStore((s) => s.shelves);
  const downloadJobs = useAppStore((s) => s.downloadJobs);
  const updateCadence = useAppStore((s) => s.updateCadence);
  const createShelf = useAppStore((s) => s.createShelf);
  const deleteShelf = useAppStore((s) => s.deleteShelf);
  const setUpdateCadence = useAppStore((s) => s.setUpdateCadence);
  const refreshLibrary = useAppStore((s) => s.refreshLibrary);
  const refreshSources = useAppStore((s) => s.refreshSources);

  const [newShelfName, setNewShelfName] = useState('');
  const [anilistClientId, setAnilistClientId] = useState('');
  const [malClientId, setMalClientId] = useState('');
  const [anilistConnected, setAnilistConnected] = useState(false);
  const [malConnected, setMalConnected] = useState(false);
  const [history, setHistory] = useState<ReadingHistoryRow[]>([]);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const redirectUri = AuthSession.makeRedirectUri({ scheme: 'vellichor', path: 'auth' });

  useEffect(() => {
    void (async () => {
      const [alId, malId, alTok, malTok] = await Promise.all([
        trackerAuthStore.getClientId('anilist'),
        trackerAuthStore.getClientId('mal'),
        trackerAuthStore.getToken('anilist'),
        trackerAuthStore.getToken('mal'),
      ]);
      setAnilistClientId(alId);
      setMalClientId(malId);
      setAnilistConnected(Boolean(alTok));
      setMalConnected(Boolean(malTok));
      if (db) {
        setHistory(await historyRepo.listRecent(db, 10));
      }
    })();
  }, [db]);

  const activeJobs = downloadJobs.filter((j) => j.status !== 'completed').length;

  const handleExportBackup = async () => {
    if (!db) return;
    setBusyAction('export');
    try {
      const json = await exportMossBackup(db);
      const path = `${FileSystem.cacheDirectory}vellichor-backup-${Date.now()}.json`;
      await FileSystem.writeAsStringAsync(path, json);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(path, { mimeType: 'application/json', dialogTitle: 'Save Vellichor Backup' });
      } else {
        Alert.alert('Backup Saved', `Saved backup to ${path}`);
      }
    } catch (err) {
      Alert.alert('Backup Failed', err instanceof Error ? err.message : 'Unable to export backup');
    } finally {
      setBusyAction(null);
    }
  };

  const handleImportMoss = async () => {
    if (!db) return;
    setBusyAction('import-moss');
    try {
      const picked = await DocumentPicker.getDocumentAsync({ type: ['application/json', 'text/plain', '*/*'] });
      if (picked.canceled || !picked.assets[0]) return;
      const raw = await FileSystem.readAsStringAsync(picked.assets[0].uri);
      const res = await importMossBackup(db, raw);
      await Promise.all([refreshLibrary(), refreshSources()]);
      Alert.alert(
        'Backup Restored',
        `Imported ${res.novelsImported} novels, ${res.chaptersImported} chapters, ${res.reposImported} repos.`
      );
    } catch (err) {
      Alert.alert('Restore Failed', err instanceof Error ? err.message : 'Invalid backup JSON');
    } finally {
      setBusyAction(null);
    }
  };

  const handleImportLnReader = async () => {
    if (!db) return;
    setBusyAction('import-ln');
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ['application/zip', 'application/x-zip-compressed', 'application/octet-stream', '*/*'],
      });
      if (picked.canceled || !picked.assets[0]) return;
      const b64 = await FileSystem.readAsStringAsync(picked.assets[0].uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const bytes = base64ToUint8Array(b64);
      const preview = await previewLnReaderZip(bytes);
      Alert.alert(
        'Import LNReader Backup?',
        `Found ${preview.novelsCount} novels, ${preview.chaptersCount} chapters, and ${preview.categoriesCount} categories.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Import',
            onPress: () => {
              void (async () => {
                setBusyAction('import-ln');
                try {
                  const res = await importLnReaderZip(db, bytes);
                  await refreshLibrary();
                  Alert.alert(
                    'LNReader Import Complete',
                    `Imported ${res.novelsImported} novels and ${res.chaptersImported} chapters.`
                  );
                } catch (err) {
                  Alert.alert(
                    'LNReader Import Failed',
                    err instanceof Error ? err.message : 'Failed to import archive'
                  );
                } finally {
                  setBusyAction(null);
                }
              })();
            },
          },
        ]
      );
    } catch (err) {
      Alert.alert('LNReader Import Failed', err instanceof Error ? err.message : 'Could not read .zip backup');
    } finally {
      setBusyAction(null);
    }
  };

  const handleConnectAniList = async () => {
    try {
      if (!anilistClientId.trim()) {
        Alert.alert('AniList Client ID Required', `Create an AniList developer app with Redirect URI:\n${redirectUri}`);
        return;
      }
      await trackerAuthStore.setClientId('anilist', anilistClientId.trim());
      const authUrl = buildAniListImplicitAuthUrl(anilistClientId.trim());
      const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUri);
      if (result.type === 'success' && result.url) {
        const token = extractAniListTokenFromRedirect(result.url);
        if (token) {
          await trackerAuthStore.setToken('anilist', token);
          setAnilistConnected(true);
          Alert.alert('AniList Connected', 'Two-way chapter and status sync is now active.');
        }
      }
    } catch (err) {
      Alert.alert('AniList Login Failed', err instanceof Error ? err.message : 'Authentication error');
    }
  };

  const handleConnectMal = async () => {
    try {
      if (!malClientId.trim()) {
        Alert.alert('MAL Client ID Required', `Create a MyAnimeList API client with Redirect URI:\n${redirectUri}`);
        return;
      }
      await trackerAuthStore.setClientId('mal', malClientId.trim());
      const verifier = `${Crypto.randomUUID()}${Crypto.randomUUID()}`.replace(/-/g, '').slice(0, 64);
      const authUrl = buildMalPkceAuthUrl(malClientId.trim(), verifier, redirectUri);
      const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUri);
      if (result.type === 'success' && result.url) {
        const queryPart = result.url.split('?')[1]?.split('#')[0] ?? '';
        const code = new URLSearchParams(queryPart).get('code');
        if (code) {
          const exchanged = await exchangeMalCodeForToken({
            clientId: malClientId.trim(),
            code,
            codeVerifier: verifier,
            redirectUri,
          });
          await trackerAuthStore.setToken('mal', exchanged.accessToken);
          if (exchanged.refreshToken) {
            await trackerAuthStore.setMalRefreshToken(exchanged.refreshToken);
          }
          setMalConnected(true);
          Alert.alert('MyAnimeList Connected', 'Two-way chapter and volume sync is now active.');
        }
      }
    } catch (err) {
      Alert.alert('MAL Login Failed', err instanceof Error ? err.message : 'Authentication error');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <ThemedText variant="screenTitle">More</ThemedText>

        <Pressable
          testID="more-queue-entry"
          onPress={() => router.push('/queue')}
          style={styles.navCard}
        >
          <View style={styles.navLeft}>
            <Download size={20} color={mossColors.accent} strokeWidth={1.8} />
            <View>
              <ThemedText variant="cardTitle">Download Queue</ThemedText>
              <ThemedText variant="caption">
                {activeJobs > 0 ? `${activeJobs} chapter(s) queued or active` : 'All downloads idle'}
              </ThemedText>
            </View>
          </View>
          <ChevronRight size={18} color={mossColors.muted} strokeWidth={1.8} />
        </Pressable>

        {/* Auto-Update Cadence */}
        <View style={styles.panel}>
          <ThemedText variant="sectionTitle">Automatic Chapter Checks</ThemedText>
          <ThemedText variant="caption">
            Background check schedule (defaults to once a week on Wi-Fi)
          </ThemedText>
          <View style={styles.chipRow}>
            {(['weekly', 'daily', 'off'] as UpdateCadence[]).map((c) => (
              <Chip
                key={c}
                label={c === 'weekly' ? 'Once a Week' : c === 'daily' ? 'Daily' : 'Manual Only'}
                active={updateCadence === c}
                onPress={() => void setUpdateCadence(c)}
              />
            ))}
          </View>
        </View>

        {/* Backup & LNReader Migration */}
        <View style={styles.panel}>
          <ThemedText variant="sectionTitle">Backup & Migration</ThemedText>
          <ThemedText variant="caption">
            Export portable JSON backups or import an existing LNReader .zip archive.
          </ThemedText>
          <View style={styles.btnStack}>
            <Button
              testID="more-export-backup"
              title="Export Vellichor Backup (.json)"
              loading={busyAction === 'export'}
              onPress={() => void handleExportBackup()}
            />
            <Button
              testID="more-import-backup"
              title="Restore Vellichor Backup (.json)"
              variant="secondary"
              loading={busyAction === 'import-moss'}
              onPress={() => void handleImportMoss()}
            />
            <Button
              testID="more-import-lnreader"
              title="Import LNReader Backup (.zip)"
              variant="ghost"
              loading={busyAction === 'import-ln'}
              onPress={() => void handleImportLnReader()}
            />
          </View>
        </View>

        {/* External Trackers */}
        <View style={styles.panel}>
          <View style={styles.rowHeader}>
            <Link2 size={18} color={mossColors.good} strokeWidth={1.8} />
            <ThemedText variant="sectionTitle">External Trackers</ThemedText>
          </View>
          <ThemedText variant="mono">Redirect URI: {redirectUri}</ThemedText>

          <View style={styles.trackerBox}>
            <ThemedText variant="cardTitle">
              AniList {anilistConnected ? '· Connected' : ''}
            </ThemedText>
            <TextInput
              value={anilistClientId}
              onChangeText={setAnilistClientId}
              placeholder="Paste your AniList Client ID"
              placeholderTextColor={mossColors.muted}
              style={styles.input}
            />
            <Button
              title={anilistConnected ? 'Reconnect AniList' : 'Connect AniList'}
              variant={anilistConnected ? 'good' : 'secondary'}
              size="sm"
              onPress={() => void handleConnectAniList()}
            />
          </View>

          <View style={styles.trackerBox}>
            <ThemedText variant="cardTitle">
              MyAnimeList {malConnected ? '· Connected' : ''}
            </ThemedText>
            <TextInput
              value={malClientId}
              onChangeText={setMalClientId}
              placeholder="Paste your MAL Client ID"
              placeholderTextColor={mossColors.muted}
              style={styles.input}
            />
            <Button
              title={malConnected ? 'Reconnect MAL' : 'Connect MyAnimeList'}
              variant={malConnected ? 'good' : 'secondary'}
              size="sm"
              onPress={() => void handleConnectMal()}
            />
          </View>
        </View>

        {/* Custom Shelves */}
        <View style={styles.panel}>
          <View style={styles.rowHeader}>
            <FolderPlus size={18} color={mossColors.accent} strokeWidth={1.8} />
            <ThemedText variant="sectionTitle">Custom Shelves</ThemedText>
          </View>
          <View style={styles.inlineForm}>
            <TextInput
              value={newShelfName}
              onChangeText={setNewShelfName}
              placeholder="New shelf (e.g. Favorites, Xianxia)"
              placeholderTextColor={mossColors.muted}
              style={[styles.input, { flex: 1 }]}
            />
            <Button
              title="Add"
              size="sm"
              onPress={async () => {
                if (!newShelfName.trim()) return;
                await createShelf(newShelfName);
                setNewShelfName('');
              }}
            />
          </View>
          {shelves.map((s) => (
            <View key={s.id} style={styles.shelfRow}>
              <ThemedText variant="body">{s.name}</ThemedText>
              <Pressable onPress={() => void deleteShelf(s.id)} hitSlop={8}>
                <Trash2 size={15} color={mossColors.muted} strokeWidth={1.8} />
              </Pressable>
            </View>
          ))}
        </View>

        {/* Recent Reading History */}
        <View style={styles.panel}>
          <View style={styles.rowHeader}>
            <Clock size={18} color={mossColors.muted} strokeWidth={1.8} />
            <ThemedText variant="sectionTitle">Recent History</ThemedText>
          </View>
          {history.length === 0 ? (
            <ThemedText variant="caption">Chapters you read will appear here automatically.</ThemedText>
          ) : (
            history.map((h) => (
              <Pressable
                key={h.id}
                onPress={() =>
                  router.push({ pathname: '/reader/[chapterId]', params: { chapterId: String(h.chapter_id) } })
                }
                style={styles.shelfRow}
              >
                <View style={{ flex: 1 }}>
                  <ThemedText variant="cardTitle" numberOfLines={1}>
                    {h.novel_title}
                  </ThemedText>
                  <ThemedText variant="caption" numberOfLines={1}>
                    {h.chapter_name}
                  </ThemedText>
                </View>
                <ChevronRight size={15} color={mossColors.muted} />
              </Pressable>
            ))
          )}
        </View>

        <View style={styles.footerRow}>
          <HardDriveDownload size={14} color={mossColors.muted} strokeWidth={1.75} />
          <ArchiveRestore size={14} color={mossColors.muted} strokeWidth={1.75} />
          <ThemedText variant="caption">Vellichor · Personal Midnight Moss Edition</ThemedText>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: mossColors.bg,
  },
  content: {
    padding: spacing.md,
    gap: spacing.md,
    paddingBottom: spacing.xxl,
  },
  navCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    borderRadius: radius.card,
    backgroundColor: mossColors.surfaceElevated,
  },
  navLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.smd,
  },
  panel: {
    padding: spacing.md,
    borderRadius: radius.card,
    backgroundColor: mossColors.surface,
    gap: spacing.smd,
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  btnStack: {
    gap: spacing.sm,
  },
  trackerBox: {
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: mossColors.border,
    gap: spacing.sm,
  },
  inlineForm: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  input: {
    backgroundColor: mossColors.surfaceElevated,
    color: mossColors.fg,
    borderRadius: radius.md,
    paddingHorizontal: spacing.smd,
    paddingVertical: spacing.sm + 2,
    fontSize: 14,
  },
  shelfRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs + 2,
    borderTopWidth: 1,
    borderTopColor: mossColors.border,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingTop: spacing.sm,
  },
});

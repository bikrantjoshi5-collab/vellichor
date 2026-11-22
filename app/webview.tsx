import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { WebView } from 'react-native-webview';
import { ArrowLeft } from 'lucide-react-native';
import { mossColors, radius, spacing } from '@/theme';
import { useAppStore } from '@/store/appStore';
import { trackerRepo } from '@/db/repositories/trackerRepo';
import { DEFAULT_USER_AGENT } from '@/plugins/shims';
import { assertSafeExternalUrl } from '@/plugins/security';
import { ThemedText } from '@/components/ThemedText';
import { Button } from '@/components/Button';

function sanitizeWebViewUrl(raw?: string): string {
  if (!raw) return 'https://www.novelupdates.com';
  try {
    return assertSafeExternalUrl(raw, 'WebView');
  } catch {
    return 'https://www.novelupdates.com';
  }
}

export default function UtilityWebViewScreen() {
  const { mode, pluginId, novelId, url } = useLocalSearchParams<{
    mode?: 'cloudflare' | 'novelupdates';
    pluginId?: string;
    novelId?: string;
    url?: string;
  }>();
  const router = useRouter();
  const db = useAppStore((s) => s.db);
  const clearCloudflareSource = useAppStore((s) => s.clearCloudflareSource);

  const safeInitialUrl = sanitizeWebViewUrl(url);
  const [currentUrl, setCurrentUrl] = useState(safeInitialUrl);
  const [pageTitle, setPageTitle] = useState(mode === 'novelupdates' ? 'NovelUpdates' : 'Verify Source');

  const handlePrimaryAction = async () => {
    if (mode === 'cloudflare' && pluginId) {
      await clearCloudflareSource(pluginId);
      router.back();
      return;
    }
    if (mode === 'novelupdates' && novelId && db) {
      const slug = currentUrl.replace(/\/$/, '').split('/').pop() || currentUrl;
      const cleanTitle = pageTitle.replace(/\s*[-|–]\s*Novel Updates.*$/i, '').trim() || slug;
      await trackerRepo.upsertLink(db, {
        novelId: Number(novelId),
        provider: 'novelupdates',
        remoteId: slug,
        remoteTitle: cleanTitle,
        remoteUrl: currentUrl,
        status: 'reading',
      });
      Alert.alert('NovelUpdates Linked', `Linked to "${cleanTitle}".`);
      router.back();
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn}>
          <ArrowLeft size={18} color={mossColors.fg} strokeWidth={1.8} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <ThemedText variant="cardTitle" numberOfLines={1}>
            {pageTitle}
          </ThemedText>
          <ThemedText variant="mono" numberOfLines={1}>
            {currentUrl}
          </ThemedText>
        </View>
        {mode === 'cloudflare' ? (
          <Button title="Done" size="sm" onPress={() => void handlePrimaryAction()} />
        ) : mode === 'novelupdates' ? (
          <Button title="Link Series" size="sm" onPress={() => void handlePrimaryAction()} />
        ) : null}
      </View>

      <WebView
        source={{ uri: safeInitialUrl }}
        userAgent={DEFAULT_USER_AGENT}
        originWhitelist={['https://*', 'http://*']}
        allowFileAccess={false}
        allowUniversalAccessFromFileURLs={false}
        domStorageEnabled
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        onShouldStartLoadWithRequest={(req) => /^https?:\/\//i.test(req.url)}
        onNavigationStateChange={(nav) => {
          if (nav.url && /^https?:\/\//i.test(nav.url)) setCurrentUrl(nav.url);
          if (nav.title) setPageTitle(nav.title);
        }}
        style={styles.webview}
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
    gap: spacing.sm,
    paddingHorizontal: spacing.smd,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: mossColors.border,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: mossColors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  webview: {
    flex: 1,
    backgroundColor: mossColors.bg,
  },
});

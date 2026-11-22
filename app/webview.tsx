import React, { useEffect, useMemo, useState } from 'react';
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

export function isHostAllowedForWebView(
  candidateUrl: string,
  allowedBaseHost: string
): boolean {
  try {
    const safe = assertSafeExternalUrl(candidateUrl, 'WebView');
    const host = new URL(safe).hostname.toLowerCase();
    const base = allowedBaseHost.toLowerCase().replace(/^www\./, '');
    return host === base || host.endsWith(`.${base}`);
  } catch {
    return false;
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
  const plugins = useAppStore((s) => s.plugins);
  const clearCloudflareSource = useAppStore((s) => s.clearCloudflareSource);

  // Strictly derive allowed initial URL & host from trusted in-app state (NEVER open arbitrary deep-link URLs!)
  const resolvedTarget = useMemo<{ initialUrl: string; allowedHost: string } | null>(() => {
    if (mode === 'novelupdates') {
      const allowedHost = 'novelupdates.com';
      if (url && isHostAllowedForWebView(url, allowedHost)) {
        return { initialUrl: assertSafeExternalUrl(url, 'NovelUpdates'), allowedHost };
      }
      return { initialUrl: 'https://www.novelupdates.com', allowedHost };
    }

    if (mode === 'cloudflare' && pluginId) {
      const installedPlugin = plugins.find((p) => p.id === pluginId && p.installed === 1 && p.site);
      if (!installedPlugin) return null;
      try {
        const safeSite = assertSafeExternalUrl(installedPlugin.site, 'Cloudflare WebView');
        const allowedHost = new URL(safeSite).hostname.toLowerCase();
        return { initialUrl: safeSite, allowedHost };
      } catch {
        return null;
      }
    }

    return null;
  }, [mode, pluginId, url, plugins]);

  useEffect(() => {
    if (!resolvedTarget) {
      router.replace('/(tabs)');
    }
  }, [resolvedTarget, router]);

  const [currentUrl, setCurrentUrl] = useState(resolvedTarget?.initialUrl ?? '');
  const [pageTitle, setPageTitle] = useState(
    mode === 'novelupdates' ? 'NovelUpdates' : 'Verify Source'
  );

  if (!resolvedTarget) {
    return null;
  }

  const isCloudflareMode = mode === 'cloudflare';

  const handlePrimaryAction = async () => {
    if (isCloudflareMode && pluginId) {
      await clearCloudflareSource(pluginId);
      router.back();
      return;
    }
    if (mode === 'novelupdates' && novelId && db) {
      if (!isHostAllowedForWebView(currentUrl, 'novelupdates.com')) {
        Alert.alert('Invalid Page', 'Navigate to a NovelUpdates series page before linking.');
        return;
      }
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
        {isCloudflareMode ? (
          <Button title="Done" size="sm" onPress={() => void handlePrimaryAction()} />
        ) : mode === 'novelupdates' ? (
          <Button title="Link Series" size="sm" onPress={() => void handlePrimaryAction()} />
        ) : null}
      </View>

      <WebView
        source={{ uri: resolvedTarget.initialUrl }}
        userAgent={DEFAULT_USER_AGENT}
        originWhitelist={['https://*', 'http://*']}
        allowFileAccess={false}
        allowUniversalAccessFromFileURLs={false}
        domStorageEnabled
        incognito={!isCloudflareMode}
        sharedCookiesEnabled={isCloudflareMode}
        thirdPartyCookiesEnabled={false}
        onShouldStartLoadWithRequest={(req) => {
          // Allow only the target site's domain (plus Cloudflare challenge domain in Cloudflare mode)
          if (isHostAllowedForWebView(req.url, resolvedTarget.allowedHost)) return true;
          if (isCloudflareMode && isHostAllowedForWebView(req.url, 'challenges.cloudflare.com')) {
            return true;
          }
          return false;
        }}
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

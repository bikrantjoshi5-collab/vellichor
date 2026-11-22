import React, { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { mossColors } from '@/theme';

/**
 * Clean deep-link landing target for `vellichor://auth` OAuth redirects so Expo Router
 * never flashes a +not-found screen when returning from AniList/MyAnimeList login.
 */
export default function AuthRedirectScreen() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/(tabs)/more');
  }, [router]);

  return (
    <View style={styles.root}>
      <ActivityIndicator color={mossColors.accent} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: mossColors.bg,
  },
});

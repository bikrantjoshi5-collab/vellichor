import React, { useEffect } from 'react';
import { ActivityIndicator, StatusBar, StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import {
  Lora_400Regular,
  Lora_400Regular_Italic,
  Lora_500Medium,
  Lora_600SemiBold,
  Lora_700Bold,
} from '@expo-google-fonts/lora';
import {
  DMSans_400Regular,
  DMSans_500Medium,
  DMSans_600SemiBold,
  DMSans_700Bold,
} from '@expo-google-fonts/dm-sans';
import {
  IBMPlexMono_400Regular,
  IBMPlexMono_500Medium,
  IBMPlexMono_600SemiBold,
} from '@expo-google-fonts/ibm-plex-mono';
import * as TaskManager from 'expo-task-manager';
import { mossColors } from '@/theme';
import { useAppStore } from '@/store/appStore';
import { openAppDatabase } from '@/db/database';
import { getRuntimePlugin } from '@/services/pluginLoader';
import {
  checkLibraryUpdates,
  sendUpdateSummaryNotification,
  WEEKLY_UPDATE_TASK_NAME,
} from '@/updates/updateScheduler';

// Register weekly background chapter-check task at module scope.
if (!TaskManager.isTaskDefined(WEEKLY_UPDATE_TASK_NAME)) {
  TaskManager.defineTask(WEEKLY_UPDATE_TASK_NAME, async () => {
    try {
      const db = await openAppDatabase();
      const report = await checkLibraryUpdates({
        db,
        getPlugin: (id) => getRuntimePlugin(db, id),
      });
      await sendUpdateSummaryNotification(report);
    } catch {
      // Background errors fail gracefully without crashing Android WorkManager.
    }
  });
}

export default function RootLayout() {
  const bootstrap = useAppStore((s) => s.bootstrap);
  const ready = useAppStore((s) => s.ready);

  const [fontsLoaded] = useFonts({
    Lora_400Regular,
    Lora_400Regular_Italic,
    Lora_500Medium,
    Lora_600SemiBold,
    Lora_700Bold,
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_600SemiBold,
    DMSans_700Bold,
    IBMPlexMono_400Regular,
    IBMPlexMono_500Medium,
    IBMPlexMono_600SemiBold,
  });

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  if (!fontsLoaded || !ready) {
    return (
      <View style={styles.splash}>
        <StatusBar barStyle="light-content" backgroundColor={mossColors.bg} />
        <ActivityIndicator color={mossColors.accent} />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <StatusBar barStyle="light-content" backgroundColor={mossColors.bg} />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: mossColors.bg },
          }}
        >
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="novel/[id]" />
          <Stack.Screen name="reader/[chapterId]" />
          <Stack.Screen name="source/[pluginId]" />
          <Stack.Screen name="queue" />
          <Stack.Screen name="webview" />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: mossColors.bg,
  },
  splash: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: mossColors.bg,
  },
});

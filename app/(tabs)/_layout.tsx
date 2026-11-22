import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Tabs } from 'expo-router';
import { BookOpen, Bell, Compass, SlidersHorizontal } from 'lucide-react-native';
import { fontFamilies, mossColors, radius } from '@/theme';
import { useAppStore } from '@/store/appStore';
import { detectPluginUpdate } from '@/plugins/semver';

export default function TabsLayout() {
  const plugins = useAppStore((s) => s.plugins);
  const outdatedCount = plugins.filter(
    (p) =>
      p.installed === 1 &&
      detectPluginUpdate({
        installedVersion: p.version,
        remoteVersion: p.remote_version,
        installedHash: p.bundle_hash,
        installedManifestHash: p.installed_manifest_hash,
        remoteHash: p.remote_hash,
        installedEtag: p.installed_etag,
        remoteEtag: p.remote_etag,
      }).hasUpdate
  ).length;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        animation: 'none',
        tabBarActiveTintColor: mossColors.accent,
        tabBarInactiveTintColor: mossColors.muted,
        tabBarStyle: styles.tabBar,
        tabBarLabelStyle: styles.tabLabel,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Library',
          tabBarButtonTestID: 'tab-library',
          tabBarIcon: ({ color, size }) => <BookOpen size={size - 2} color={color} strokeWidth={1.8} />,
        }}
      />
      <Tabs.Screen
        name="updates"
        options={{
          title: 'Updates',
          tabBarButtonTestID: 'tab-updates',
          tabBarIcon: ({ color, size }) => <Bell size={size - 2} color={color} strokeWidth={1.8} />,
        }}
      />
      <Tabs.Screen
        name="sources"
        options={{
          title: 'Sources',
          tabBarButtonTestID: 'tab-sources',
          tabBarIcon: ({ color, size }) => (
            <View>
              <Compass size={size - 2} color={color} strokeWidth={1.8} />
              {outdatedCount > 0 ? <View style={styles.updateDot} /> : null}
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: 'More',
          tabBarButtonTestID: 'tab-more',
          tabBarIcon: ({ color, size }) => (
            <SlidersHorizontal size={size - 2} color={color} strokeWidth={1.8} />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: mossColors.surface,
    borderTopWidth: 1,
    borderTopColor: mossColors.border,
    height: 64,
    paddingBottom: 8,
    paddingTop: 6,
  },
  tabLabel: {
    fontFamily: fontFamilies.uiMedium,
    fontSize: 11,
  },
  updateDot: {
    position: 'absolute',
    top: -1,
    right: -3,
    width: 7,
    height: 7,
    borderRadius: radius.full,
    backgroundColor: mossColors.warn,
  },
});

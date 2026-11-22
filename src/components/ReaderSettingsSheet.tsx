import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { X } from 'lucide-react-native';
import {
  mossColors,
  radius,
  readerSurfaces,
  spacing,
  type ReaderSurfaceId,
} from '@/theme';
import type { ReaderPrefs } from '@/store/appStore';
import { ThemedText } from './ThemedText';
import { Chip } from './Chip';

export interface ReaderSettingsSheetProps {
  visible: boolean;
  prefs: ReaderPrefs;
  ttsEnabled: boolean;
  onToggleTts: (next: boolean) => void;
  onUpdatePrefs: (patch: Partial<ReaderPrefs>) => void;
  onClose: () => void;
}

const FONT_SIZES = [15, 17, 19, 21];
const LINE_HEIGHTS = [1.55, 1.75, 1.95];

export function ReaderSettingsSheet({
  visible,
  prefs,
  ttsEnabled,
  onToggleTts,
  onUpdatePrefs,
  onClose,
}: ReaderSettingsSheetProps) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <ThemedText variant="sectionTitle">Reader Settings</ThemedText>
            <Pressable
              testID="reader-settings-close"
              accessibilityRole="button"
              accessibilityLabel="Close settings"
              onPress={onClose}
              hitSlop={8}
              style={styles.closeBtn}
            >
              <X size={18} color={mossColors.muted} strokeWidth={1.8} />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
            <View style={styles.row}>
              <View style={styles.rowText}>
                <ThemedText variant="cardTitle">Voice Read-Aloud (TTS)</ThemedText>
                <ThemedText variant="caption">
                  Off by default · docks cleanly below text when switched on
                </ThemedText>
              </View>
              <Switch
                testID="reader-tts-switch"
                value={ttsEnabled}
                onValueChange={onToggleTts}
                trackColor={{ false: mossColors.surfaceElevated, true: mossColors.accent }}
                thumbColor={ttsEnabled ? mossColors.accentFg : mossColors.fg}
              />
            </View>

            <View style={styles.section}>
              <ThemedText variant="caption" style={styles.sectionLabel}>
                Page Surface
              </ThemedText>
              <View style={styles.chipRow}>
                {(['moss', 'paper', 'oled'] as ReaderSurfaceId[]).map((id) => (
                  <Chip
                    key={id}
                    label={readerSurfaces[id].label}
                    active={prefs.surface === id}
                    onPress={() => onUpdatePrefs({ surface: id })}
                  />
                ))}
              </View>
            </View>

            <View style={styles.section}>
              <ThemedText variant="caption" style={styles.sectionLabel}>
                Text Size
              </ThemedText>
              <View style={styles.chipRow}>
                {FONT_SIZES.map((sz) => (
                  <Chip
                    key={sz}
                    label={`${sz}pt`}
                    active={prefs.fontSize === sz}
                    onPress={() => onUpdatePrefs({ fontSize: sz })}
                  />
                ))}
              </View>
            </View>

            <View style={styles.section}>
              <ThemedText variant="caption" style={styles.sectionLabel}>
                Line Spacing
              </ThemedText>
              <View style={styles.chipRow}>
                {LINE_HEIGHTS.map((lh) => (
                  <Chip
                    key={lh}
                    label={`${lh.toFixed(2)}×`}
                    active={prefs.lineHeight === lh}
                    onPress={() => onUpdatePrefs({ lineHeight: lh })}
                  />
                ))}
              </View>
            </View>

            <View style={styles.row}>
              <View style={styles.rowText}>
                <ThemedText variant="cardTitle">Tap-Zone Scrolling</ThemedText>
                <ThemedText variant="caption">
                  Tap bottom or top zone to jump one screen cleanly
                </ThemedText>
              </View>
              <Switch
                value={prefs.tapZonesEnabled}
                onValueChange={(v) => onUpdatePrefs({ tapZonesEnabled: v })}
                trackColor={{ false: mossColors.surfaceElevated, true: mossColors.good }}
                thumbColor={mossColors.fg}
              />
            </View>

            <View style={styles.row}>
              <View style={styles.rowText}>
                <ThemedText variant="cardTitle">Keep Screen Awake</ThemedText>
                <ThemedText variant="caption">Prevent sleep while reading</ThemedText>
              </View>
              <Switch
                value={prefs.keepScreenAwake}
                onValueChange={(v) => onUpdatePrefs({ keepScreenAwake: v })}
                trackColor={{ false: mossColors.surfaceElevated, true: mossColors.good }}
                thumbColor={mossColors.fg}
              />
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: mossColors.backdrop,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: mossColors.bg,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    borderTopWidth: 1,
    borderColor: mossColors.border,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.smd,
    paddingBottom: spacing.xl,
    maxHeight: '80%',
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: radius.full,
    backgroundColor: mossColors.border,
    alignSelf: 'center',
    marginBottom: spacing.smd,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.smd,
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    backgroundColor: mossColors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    gap: spacing.md,
    paddingBottom: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.smd,
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: mossColors.border,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  section: {
    gap: spacing.sm,
  },
  sectionLabel: {
    color: mossColors.muted,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
});

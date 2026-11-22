import React, { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import * as Speech from 'expo-speech';
import { Minus, Plus, Volume2, X } from 'lucide-react-native';
import {
  mossColors,
  motion,
  radius,
  readerSurfaces,
  spacing,
  type ReaderSurfaceId,
} from '@/theme';
import type { ReaderPrefs } from '@/store/appStore';
import {
  pickDefaultNaturalVoice,
  rankAndLabelVoices,
  TTS_PITCH_PRESETS,
  TTS_SPEED_PRESETS,
  type CleanVoiceOption,
} from '@/reader/voiceCatalog';
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
  const [voices, setVoices] = useState<CleanVoiceOption[]>([]);
  const [showAllVoices, setShowAllVoices] = useState(false);

  useEffect(() => {
    if (!visible) return;
    void Speech.getAvailableVoicesAsync()
      .then((list) => {
        const ranked = rankAndLabelVoices(list, {
          includeAllLanguages: showAllVoices,
          maxCount: showAllVoices ? 40 : 28,
        });
        setVoices(ranked);
        const preferred = pickDefaultNaturalVoice(ranked, prefs.ttsVoice);
        if (preferred && preferred.identifier !== prefs.ttsVoice) {
          onUpdatePrefs({ ttsVoice: preferred.identifier });
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, showAllVoices]);

  const previewVoice = (voiceId?: string) => {
    Speech.stop();
    Speech.speak('The lamp glowed softly as the next chapter began.', {
      voice: voiceId,
      rate: prefs.ttsRate,
      pitch: prefs.ttsPitch,
    });
  };

  const nudgeRate = (delta: number) => {
    const next = Math.round(Math.max(0.75, Math.min(2.0, prefs.ttsRate + delta)) * 100) / 100;
    onUpdatePrefs({ ttsRate: next });
  };

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
            {/* Voice Read-Aloud Toggle */}
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

            {/* Explicit Reading Speed Control (always accessible so user can set preferred speed cleanly) */}
            <View style={styles.section}>
              <View style={styles.speedHeader}>
                <ThemedText variant="caption" style={styles.sectionLabel}>
                  Chapter Reading Speed
                </ThemedText>
                <View style={styles.nudgeRow}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Decrease reading speed"
                    onPress={() => nudgeRate(-0.05)}
                    style={styles.nudgeBtn}
                  >
                    <Minus size={14} color={mossColors.fg} strokeWidth={2} />
                  </Pressable>
                  <ThemedText variant="mono" style={{ color: mossColors.accent }}>
                    {prefs.ttsRate.toFixed(2).replace(/0$/, '')}x
                  </ThemedText>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Increase reading speed"
                    onPress={() => nudgeRate(0.05)}
                    style={styles.nudgeBtn}
                  >
                    <Plus size={14} color={mossColors.fg} strokeWidth={2} />
                  </Pressable>
                </View>
              </View>
              <View style={styles.chipRow}>
                {TTS_SPEED_PRESETS.map((spd) => (
                  <Chip
                    key={spd}
                    label={`${spd}x`}
                    active={Math.abs(prefs.ttsRate - spd) < 0.01}
                    onPress={() => onUpdatePrefs({ ttsRate: spd })}
                  />
                ))}
              </View>
            </View>

            {/* Voice Tone / Pitch */}
            <View style={styles.section}>
              <ThemedText variant="caption" style={styles.sectionLabel}>
                Voice Tone
              </ThemedText>
              <View style={styles.chipRow}>
                {TTS_PITCH_PRESETS.map((p) => (
                  <Chip
                    key={p.label}
                    label={p.label}
                    active={Math.abs(prefs.ttsPitch - p.value) < 0.02}
                    onPress={() => onUpdatePrefs({ ttsPitch: p.value })}
                  />
                ))}
              </View>
            </View>

            {/* Clean Ranked Voices with Preview */}
            {voices.length > 0 ? (
              <View style={styles.section}>
                <View style={styles.speedHeader}>
                  <ThemedText variant="caption" style={styles.sectionLabel}>
                    Narrator Voice ({voices.length} clean voices)
                  </ThemedText>
                  <Pressable onPress={() => setShowAllVoices((v) => !v)}>
                    <ThemedText variant="caption" style={{ color: mossColors.accent }}>
                      {showAllVoices ? 'English HD' : 'All Languages'}
                    </ThemedText>
                  </Pressable>
                </View>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.voiceCardsRow}
                >
                  {voices.map((v) => {
                    const selected = prefs.ttsVoice === v.identifier;
                    return (
                      <Pressable
                        key={v.identifier}
                        onPress={() => {
                          onUpdatePrefs({ ttsVoice: v.identifier });
                          previewVoice(v.identifier);
                        }}
                        style={({ pressed }) => [
                          styles.voiceCard,
                          selected && styles.voiceCardActive,
                          pressed && { transform: [{ scale: motion.pressScale }] },
                        ]}
                      >
                        <View style={styles.voiceTop}>
                          <ThemedText
                            variant="cardTitle"
                            style={{ color: selected ? mossColors.accentFg : mossColors.fg, flex: 1 }}
                            numberOfLines={1}
                          >
                            {v.displayName}
                          </ThemedText>
                          <Volume2
                            size={14}
                            color={selected ? mossColors.accentFg : v.isNeural ? mossColors.good : mossColors.muted}
                            strokeWidth={1.9}
                          />
                        </View>
                        <ThemedText
                          variant="caption"
                          style={{ color: selected ? mossColors.accentFg : mossColors.muted }}
                          numberOfLines={1}
                        >
                          {v.subtitle}
                        </ThemedText>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>
            ) : null}

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
    maxHeight: '86%',
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
  speedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  nudgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  nudgeBtn: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    backgroundColor: mossColors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  voiceCardsRow: {
    gap: spacing.sm,
    paddingVertical: 2,
  },
  voiceCard: {
    width: 172,
    padding: spacing.smd,
    borderRadius: radius.md,
    backgroundColor: mossColors.surface,
    gap: 4,
  },
  voiceCardActive: {
    backgroundColor: mossColors.accent,
  },
  voiceTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
});

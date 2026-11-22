import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ListStart, Pause, Play, SkipBack, SkipForward, X } from 'lucide-react-native';
import { motion, radius, spacing, type ReaderSurfacePalette } from '@/theme';
import { ThemedText } from './ThemedText';

export interface TtsDockedBarProps {
  palette: ReaderSurfacePalette;
  playing: boolean;
  rate: number;
  paragraphLabel: string;
  pickingParagraph?: boolean;
  onTogglePickParagraph?: () => void;
  onTogglePlay: () => void;
  onPrev: () => void;
  onNext: () => void;
  onCycleRate: () => void;
  onDisable: () => void;
}

export function TtsDockedBar({
  palette,
  playing,
  rate,
  paragraphLabel,
  pickingParagraph = false,
  onTogglePickParagraph,
  onTogglePlay,
  onPrev,
  onNext,
  onCycleRate,
  onDisable,
}: TtsDockedBarProps) {
  return (
    <View
      testID="tts-docked-bar"
      style={[
        styles.bar,
        {
          backgroundColor: palette.surface,
          borderTopColor: palette.border,
        },
      ]}
    >
      <View style={styles.left}>
        <Pressable
          testID="tts-play-pause"
          accessibilityRole="button"
          accessibilityLabel={playing ? 'Pause voice reader' : 'Play voice reader'}
          onPress={onTogglePlay}
          style={({ pressed }) => [
            styles.playBtn,
            { backgroundColor: palette.accent },
            pressed && { transform: [{ scale: motion.pressScale }] },
          ]}
        >
          {playing ? (
            <Pause size={16} color={palette.accentFg} strokeWidth={2} />
          ) : (
            <Play size={16} color={palette.accentFg} strokeWidth={2} />
          )}
        </Pressable>

        <View style={styles.meta}>
          <ThemedText variant="cardTitle" style={{ color: palette.fg }} numberOfLines={1}>
            {pickingParagraph ? 'Tap a paragraph…' : playing ? 'Reading aloud' : 'Voice paused'}
          </ThemedText>
          <ThemedText variant="caption" style={{ color: palette.muted }} numberOfLines={1}>
            {paragraphLabel}
          </ThemedText>
        </View>
      </View>

      <View style={styles.controls}>
        {onTogglePickParagraph ? (
          <Pressable
            testID="tts-pick-paragraph"
            accessibilityRole="button"
            accessibilityLabel="Pick starting paragraph"
            onPress={onTogglePickParagraph}
            hitSlop={6}
            style={[
              styles.iconBtn,
              pickingParagraph && { backgroundColor: palette.accent },
            ]}
          >
            <ListStart
              size={16}
              color={pickingParagraph ? palette.accentFg : palette.fg}
              strokeWidth={1.9}
            />
          </Pressable>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Previous paragraph"
          onPress={onPrev}
          hitSlop={6}
          style={styles.iconBtn}
        >
          <SkipBack size={16} color={palette.fg} strokeWidth={1.8} />
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Next paragraph"
          onPress={onNext}
          hitSlop={6}
          style={styles.iconBtn}
        >
          <SkipForward size={16} color={palette.fg} strokeWidth={1.8} />
        </Pressable>

        <Pressable
          testID="tts-rate-btn"
          accessibilityRole="button"
          accessibilityLabel="Change reading speed"
          onPress={onCycleRate}
          style={[styles.rateChip, { borderColor: palette.border }]}
        >
          <ThemedText variant="mono" style={{ color: palette.fg }}>
            {rate.toFixed(2).replace(/\.00$/, '.0')}x
          </ThemedText>
        </Pressable>

        <Pressable
          testID="tts-close-btn"
          accessibilityRole="button"
          accessibilityLabel="Turn off voice reader"
          onPress={onDisable}
          hitSlop={6}
          style={styles.iconBtn}
        >
          <X size={17} color={palette.muted} strokeWidth={1.8} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.smd,
    borderTopWidth: 1,
    gap: spacing.xs,
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
  },
  playBtn: {
    width: 38,
    height: 38,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  meta: {
    flex: 1,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  iconBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rateChip: {
    paddingHorizontal: spacing.sm - 1,
    paddingVertical: spacing.xs + 1,
    borderRadius: radius.sm,
    borderWidth: 1,
    marginHorizontal: 2,
  },
});

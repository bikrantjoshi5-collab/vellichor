import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { mossColors, radius } from '@/theme';

export interface ProgressBarProps {
  progress: number; // 0 to 100
  color?: string;
  height?: number;
  style?: StyleProp<ViewStyle>;
}

export function ProgressBar({
  progress,
  color = mossColors.good,
  height = 3,
  style,
}: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, progress));
  return (
    <View style={[styles.track, { height }, style]}>
      <View style={[styles.fill, { width: `${clamped}%`, backgroundColor: color }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    width: '100%',
    borderRadius: radius.full,
    backgroundColor: mossColors.border,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: radius.full,
  },
});

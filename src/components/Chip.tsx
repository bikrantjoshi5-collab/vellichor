import React from 'react';
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { mossColors, motion, radius, spacing } from '@/theme';
import { ThemedText } from './ThemedText';

export interface ChipProps {
  label: string;
  active?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
}

export function Chip({ label, active = false, testID, style, onPress }: ChipProps) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [
        styles.chip,
        active ? styles.active : styles.inactive,
        pressed && { transform: [{ scale: motion.pressScale }] },
        style,
      ]}
    >
      <ThemedText
        variant="caption"
        style={{ color: active ? mossColors.accentFg : mossColors.muted }}
        numberOfLines={1}
      >
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingVertical: spacing.xs + 3,
    paddingHorizontal: spacing.smd + 2,
    borderRadius: radius.full,
    justifyContent: 'center',
    alignItems: 'center',
  },
  active: {
    backgroundColor: mossColors.accent,
  },
  inactive: {
    backgroundColor: mossColors.surface,
  },
});

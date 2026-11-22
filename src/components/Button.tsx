import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { mossColors, motion, radius, spacing } from '@/theme';
import { ThemedText } from './ThemedText';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'warn' | 'good';
export type ButtonSize = 'sm' | 'md' | 'lg';

const variantMap: Record<ButtonVariant, { bg: string; fg: string; border?: string }> = {
  primary: { bg: mossColors.accent, fg: mossColors.accentFg },
  secondary: { bg: mossColors.surfaceElevated, fg: mossColors.fg },
  ghost: { bg: 'transparent', fg: mossColors.muted, border: mossColors.border },
  warn: { bg: mossColors.warnSoft, fg: mossColors.warn },
  good: { bg: mossColors.goodSoft, fg: mossColors.good },
};

const sizeMap: Record<ButtonSize, { pv: number; ph: number; minH: number }> = {
  sm: { pv: spacing.xs + 2, ph: spacing.smd, minH: 34 },
  md: { pv: spacing.sm + 2, ph: spacing.md, minH: 44 },
  lg: { pv: spacing.smd + 2, ph: spacing.lg, minH: 50 },
};

export interface ButtonProps {
  title: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  disabled?: boolean;
  haptic?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
}

export function Button({
  title,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  haptic = true,
  testID,
  style,
  onPress,
}: ButtonProps) {
  const palette = variantMap[variant];
  const dims = sizeMap[size];
  const isDisabled = disabled || loading;

  const handlePress = () => {
    if (haptic) {
      Haptics.selectionAsync().catch(() => {});
    }
    onPress?.();
  };

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      onPress={handlePress}
      hitSlop={4}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor: palette.bg,
          borderColor: palette.border ?? 'transparent',
          borderWidth: palette.border ? 1 : 0,
          paddingVertical: dims.pv,
          paddingHorizontal: dims.ph,
          minHeight: dims.minH,
          opacity: isDisabled ? 0.45 : pressed ? 0.9 : 1,
          transform: [{ scale: pressed ? motion.pressScale : 1 }],
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={palette.fg} />
      ) : (
        <ThemedText
          variant={size === 'sm' ? 'caption' : 'cardTitle'}
          style={{ color: palette.fg }}
          numberOfLines={1}
        >
          {title}
        </ThemedText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.md,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
});

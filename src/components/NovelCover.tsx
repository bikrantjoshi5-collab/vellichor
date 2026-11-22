import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { mossColors, radius, spacing } from '@/theme';
import { ThemedText } from './ThemedText';

export interface NovelCoverProps {
  uri?: string | null;
  title: string;
  style?: StyleProp<ViewStyle>;
}

export function NovelCover({ uri, title, style }: NovelCoverProps) {
  const initials = title
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <View style={[styles.frame, style]}>
      {uri ? (
        <Image
          source={{ uri }}
          recyclingKey={uri}
          cachePolicy="memory-disk"
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={140}
        />
      ) : (
        <View style={styles.placeholder}>
          <View style={styles.spine} />
          <ThemedText variant="sectionTitle" style={styles.glyph}>
            {initials || 'V'}
          </ThemedText>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    borderRadius: radius.cover,
    borderCurve: 'continuous',
    overflow: 'hidden',
    backgroundColor: mossColors.coverPlaceholderBg,
  },
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.sm,
  },
  spine: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 5,
    backgroundColor: mossColors.border,
  },
  glyph: {
    color: mossColors.coverPlaceholderAccent,
    letterSpacing: 1.5,
  },
});

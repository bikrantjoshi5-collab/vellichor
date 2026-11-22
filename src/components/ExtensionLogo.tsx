import React, { useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { mossColors, radius } from '@/theme';
import { ThemedText } from './ThemedText';

export interface ExtensionLogoProps {
  uri?: string | null;
  name: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
}

export function ExtensionLogo({ uri, name, size = 40, style }: ExtensionLogoProps) {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(uri && !failed);
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
    .slice(0, 2);

  return (
    <View
      style={[
        styles.box,
        {
          width: size,
          height: size,
          borderRadius: size >= 40 ? radius.md - 2 : radius.sm,
        },
        style,
      ]}
    >
      {showImage ? (
        <Image
          source={{ uri: uri! }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={150}
          onError={() => setFailed(true)}
        />
      ) : (
        <ThemedText variant="mono" style={{ color: mossColors.fg }}>
          {initials || 'EX'}
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: mossColors.surfaceElevated,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
});

import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { X, ZoomIn, ZoomOut } from 'lucide-react-native';
import { mossColors, radius, spacing } from '@/theme';
import { ThemedText } from './ThemedText';

export interface IllustrationLightboxProps {
  uri: string | null;
  alt?: string;
  onClose: () => void;
}

export function IllustrationLightbox({ uri, alt, onClose }: IllustrationLightboxProps) {
  const [zoomed, setZoomed] = useState(false);

  return (
    <Modal visible={Boolean(uri)} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.topBar}>
          <ThemedText variant="caption" style={styles.caption} numberOfLines={1}>
            {alt || 'Light Novel Illustration'}
          </ThemedText>
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={zoomed ? 'Zoom out illustration' : 'Zoom in illustration'}
              onPress={() => setZoomed((z) => !z)}
              style={styles.iconBtn}
            >
              {zoomed ? (
                <ZoomOut size={18} color={mossColors.fg} strokeWidth={1.8} />
              ) : (
                <ZoomIn size={18} color={mossColors.fg} strokeWidth={1.8} />
              )}
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close illustration viewer"
              onPress={() => {
                setZoomed(false);
                onClose();
              }}
              style={styles.iconBtn}
            >
              <X size={18} color={mossColors.fg} strokeWidth={1.8} />
            </Pressable>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          maximumZoomScale={3}
          minimumZoomScale={1}
          centerContent
          horizontal={zoomed}
        >
          {uri ? (
            <Image
              source={{ uri }}
              style={zoomed ? styles.zoomedImage : styles.fitImage}
              contentFit="contain"
            />
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: mossColors.overlayDark,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing.xl + spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.smd,
  },
  caption: {
    flex: 1,
    color: mossColors.fg,
    marginRight: spacing.sm,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    backgroundColor: mossColors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
  },
  fitImage: {
    width: 340,
    height: 520,
  },
  zoomedImage: {
    width: 680,
    height: 980,
  },
});

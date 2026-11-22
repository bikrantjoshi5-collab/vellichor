import React from 'react';
import { Modal, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Image } from 'expo-image';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { RotateCcw, X } from 'lucide-react-native';
import { mossColors, radius, spacing } from '@/theme';
import { ThemedText } from './ThemedText';

export interface IllustrationLightboxProps {
  uri: string | null;
  alt?: string;
  onClose: () => void;
}

export function IllustrationLightbox({ uri, alt, onClose }: IllustrationLightboxProps) {
  const { width, height } = useWindowDimensions();
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedX = useSharedValue(0);
  const savedY = useSharedValue(0);

  const resetZoom = () => {
    scale.set(withSpring(1, { duration: 280, dampingRatio: 1 }));
    savedScale.set(1);
    translateX.set(withSpring(0, { duration: 280, dampingRatio: 1 }));
    translateY.set(withSpring(0, { duration: 280, dampingRatio: 1 }));
    savedX.set(0);
    savedY.set(0);
  };

  const pinchGesture = Gesture.Pinch()
    .onUpdate((e) => {
      const next = Math.max(1, Math.min(4, savedScale.get() * e.scale));
      scale.set(next);
    })
    .onEnd(() => {
      const cur = scale.get();
      if (cur <= 1.05) {
        scale.set(withSpring(1, { duration: 260, dampingRatio: 1 }));
        savedScale.set(1);
        translateX.set(withSpring(0, { duration: 260, dampingRatio: 1 }));
        translateY.set(withSpring(0, { duration: 260, dampingRatio: 1 }));
        savedX.set(0);
        savedY.set(0);
      } else {
        savedScale.set(cur);
      }
    });

  const panGesture = Gesture.Pan()
    .onUpdate((e) => {
      if (scale.get() <= 1.02) return;
      translateX.set(savedX.get() + e.translationX);
      translateY.set(savedY.get() + e.translationY);
    })
    .onEnd(() => {
      savedX.set(translateX.get());
      savedY.set(translateY.get());
    });

  const composed = Gesture.Simultaneous(pinchGesture, panGesture);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.get() },
      { translateY: translateY.get() },
      { scale: scale.get() },
    ],
  }));

  return (
    <Modal
      visible={Boolean(uri)}
      transparent
      animationType="fade"
      onRequestClose={() => {
        resetZoom();
        onClose();
      }}
    >
      <GestureHandlerRootView style={styles.root}>
        <View style={styles.topBar}>
          <ThemedText variant="caption" style={styles.caption} numberOfLines={1}>
            {alt || 'Light Novel Illustration'}
          </ThemedText>
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Reset illustration zoom"
              onPress={resetZoom}
              style={styles.iconBtn}
            >
              <RotateCcw size={17} color={mossColors.fg} strokeWidth={1.8} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close illustration viewer"
              onPress={() => {
                resetZoom();
                onClose();
              }}
              style={styles.iconBtn}
            >
              <X size={18} color={mossColors.fg} strokeWidth={1.8} />
            </Pressable>
          </View>
        </View>

        <View style={styles.stage}>
          {uri ? (
            <GestureDetector gesture={composed}>
              <Animated.View style={animatedStyle}>
                <Image
                  source={{ uri }}
                  style={{ width: width - spacing.md * 2, height: height * 0.78 }}
                  contentFit="contain"
                />
              </Animated.View>
            </GestureDetector>
          ) : null}
        </View>
      </GestureHandlerRootView>
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
  stage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});

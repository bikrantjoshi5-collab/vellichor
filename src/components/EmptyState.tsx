import React from 'react';
import { StyleSheet, View } from 'react-native';
import { spacing } from '@/theme';
import { ThemedText } from './ThemedText';
import { Button } from './Button';

export interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ icon, title, message, actionLabel, onAction }: EmptyStateProps) {
  return (
    <View style={styles.wrap}>
      <View style={styles.iconBox}>{icon}</View>
      <ThemedText variant="sectionTitle" style={styles.center}>
        {title}
      </ThemedText>
      <ThemedText variant="subhead" style={styles.center}>
        {message}
      </ThemedText>
      {actionLabel && onAction ? (
        <Button title={actionLabel} onPress={onAction} style={styles.btn} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl,
    gap: spacing.sm,
  },
  iconBox: {
    marginBottom: spacing.xs,
    opacity: 0.9,
  },
  center: {
    textAlign: 'center',
  },
  btn: {
    marginTop: spacing.smd,
  },
});

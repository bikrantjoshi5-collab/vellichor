import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Check, Plus, Tag, Trash2, X } from 'lucide-react-native';
import { labelPalette, mossColors, motion, radius, spacing, type LabelColorToken } from '@/theme';
import type { ShelfRow } from '@/db/types';
import { ThemedText } from './ThemedText';
import { Button } from './Button';

const COLOR_KEYS: LabelColorToken[] = ['terracotta', 'mint', 'ochre', 'sage', 'slate', 'plum'];

export interface LabelManagerSheetProps {
  visible: boolean;
  labels: ShelfRow[];
  /** When set, opens in quick-assign mode for a specific novel (plus allows creating new labels inline). */
  targetNovel?: { id: number; title: string; assignedIds: number[] } | null;
  onCreateLabel: (name: string, colorToken: LabelColorToken) => Promise<void>;
  onDeleteLabel: (id: number) => Promise<void>;
  onToggleNovelLabel?: (novelId: number, labelId: number) => Promise<void>;
  onClose: () => void;
}

export function LabelManagerSheet({
  visible,
  labels,
  targetNovel,
  onCreateLabel,
  onDeleteLabel,
  onToggleNovelLabel,
  onClose,
}: LabelManagerSheetProps) {
  const [name, setName] = useState('');
  const [selectedColor, setSelectedColor] = useState<LabelColorToken>('terracotta');

  const handleAdd = async () => {
    if (!name.trim()) return;
    await onCreateLabel(name.trim(), selectedColor);
    setName('');
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <ThemedText variant="sectionTitle" numberOfLines={1}>
                {targetNovel ? 'Assign Labels' : 'Library Labels'}
              </ThemedText>
              <ThemedText variant="caption" numberOfLines={1}>
                {targetNovel
                  ? targetNovel.title
                  : 'Group novels by genre, mood, or priority without changing tracker status'}
              </ThemedText>
            </View>
            <Pressable onPress={onClose} style={styles.closeBtn}>
              <X size={18} color={mossColors.muted} strokeWidth={1.8} />
            </Pressable>
          </View>

          {/* Create new colored label */}
          <View style={styles.createBox}>
            <View style={styles.inputRow}>
              <TextInput
                testID="label-name-input"
                value={name}
                onChangeText={setName}
                placeholder="New label (e.g. Favorites, Peak, Xianxia)..."
                placeholderTextColor={mossColors.muted}
                style={styles.input}
                onSubmitEditing={() => void handleAdd()}
              />
              <Button testID="label-add-btn" title="Add" size="sm" onPress={() => void handleAdd()} />
            </View>

            <View style={styles.colorRow}>
              {COLOR_KEYS.map((key) => {
                const tok = labelPalette[key];
                const isSelected = selectedColor === key;
                return (
                  <Pressable
                    key={key}
                    accessibilityRole="button"
                    accessibilityLabel={tok.name}
                    onPress={() => setSelectedColor(key)}
                    style={[
                      styles.colorDotWrap,
                      isSelected && { borderColor: mossColors.fg },
                    ]}
                  >
                    <View style={[styles.colorDot, { backgroundColor: tok.dot }]} />
                  </Pressable>
                );
              })}
            </View>
          </View>

          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {labels.length === 0 ? (
              <View style={styles.emptyBox}>
                <Tag size={22} color={mossColors.muted} strokeWidth={1.6} />
                <ThemedText variant="caption">
                  No labels yet. Add one above to organize your shelf!
                </ThemedText>
              </View>
            ) : (
              labels.map((label) => {
                const tok =
                  labelPalette[(label.color_token as LabelColorToken) ?? 'terracotta'] ??
                  labelPalette.terracotta;
                const isAssigned = targetNovel?.assignedIds.includes(label.id) ?? false;

                return (
                  <Pressable
                    key={label.id}
                    onPress={() => {
                      if (targetNovel && onToggleNovelLabel) {
                        void onToggleNovelLabel(targetNovel.id, label.id);
                      }
                    }}
                    style={({ pressed }) => [
                      styles.labelRow,
                      isAssigned && { backgroundColor: tok.bg },
                      pressed && targetNovel && { transform: [{ scale: motion.pressScale }] },
                    ]}
                  >
                    <View style={styles.labelLeft}>
                      <View style={[styles.rowDot, { backgroundColor: tok.dot }]} />
                      <ThemedText variant="cardTitle" style={{ flex: 1 }} numberOfLines={1}>
                        {label.name}
                      </ThemedText>
                    </View>

                    {targetNovel ? (
                      <View style={[styles.checkBox, isAssigned && { backgroundColor: tok.dot, borderColor: tok.dot }]}>
                        {isAssigned ? <Check size={13} color={mossColors.accentFg} strokeWidth={2.4} /> : null}
                      </View>
                    ) : (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Delete label ${label.name}`}
                        onPress={() => void onDeleteLabel(label.id)}
                        hitSlop={8}
                      >
                        <Trash2 size={15} color={mossColors.muted} strokeWidth={1.8} />
                      </Pressable>
                    )}
                  </Pressable>
                );
              })
            )}
          </ScrollView>

          <View style={styles.footer}>
            <Plus size={14} color={mossColors.muted} strokeWidth={1.8} />
            <ThemedText variant="caption">
              Tip: Long-press any novel in your Library to tag it with labels instantly.
            </ThemedText>
          </View>
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
    padding: spacing.md,
    maxHeight: '82%',
    gap: spacing.smd,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: radius.full,
    backgroundColor: mossColors.border,
    alignSelf: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    backgroundColor: mossColors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createBox: {
    backgroundColor: mossColors.surface,
    borderRadius: radius.md,
    padding: spacing.smd,
    gap: spacing.sm,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  input: {
    flex: 1,
    backgroundColor: mossColors.surfaceElevated,
    color: mossColors.fg,
    borderRadius: radius.sm + 2,
    paddingHorizontal: spacing.smd,
    paddingVertical: spacing.sm,
    fontSize: 14,
  },
  colorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  colorDotWrap: {
    width: 28,
    height: 28,
    borderRadius: radius.full,
    borderWidth: 2,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  colorDot: {
    width: 18,
    height: 18,
    borderRadius: radius.full,
  },
  list: {
    maxHeight: 280,
  },
  listContent: {
    gap: spacing.xs + 2,
    paddingBottom: spacing.sm,
  },
  emptyBox: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.smd,
    paddingHorizontal: spacing.smd,
    borderRadius: radius.md,
    backgroundColor: mossColors.surface,
    gap: spacing.sm,
  },
  labelLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
  },
  rowDot: {
    width: 10,
    height: 10,
    borderRadius: radius.full,
  },
  checkBox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: mossColors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingTop: spacing.xs,
  },
});

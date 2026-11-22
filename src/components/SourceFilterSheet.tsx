import React, { useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  View,
} from 'react-native';
import { ChevronDown, ChevronRight, Minus, Plus, RotateCcw, X } from 'lucide-react-native';
import { mossColors, motion, radius, spacing } from '@/theme';
import type { PluginFilterItem, PluginFilters } from '@/plugins/types';
import {
  cycleExcludableOption,
  getExcludableOptionState,
  normalizeFilterKind,
  toggleCheckboxOption,
  updateFilterValue,
} from '@/plugins/filters';
import { ThemedText } from './ThemedText';
import { Button } from './Button';
import { Chip } from './Chip';

export interface SourceFilterSheetProps {
  visible: boolean;
  sourceName: string;
  filters: PluginFilters;
  showLatestNovels?: boolean;
  hideLatestToggle?: boolean;
  onChangeFilters: (next: PluginFilters) => void;
  onChangeShowLatest?: (next: boolean) => void;
  onReset: () => void;
  onApply: () => void;
  onClose: () => void;
}

export function SourceFilterSheet({
  visible,
  sourceName,
  filters,
  showLatestNovels = false,
  hideLatestToggle = false,
  onChangeFilters,
  onChangeShowLatest,
  onReset,
  onApply,
  onClose,
}: SourceFilterSheetProps) {
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const entries = Object.entries(filters);

  const toggleGroup = (key: string) => {
    setExpandedGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const renderFilterControl = (key: string, item: PluginFilterItem) => {
    const kind = normalizeFilterKind(item.type);

    if (kind === 'text') {
      return (
        <View key={key} style={styles.filterSection}>
          <ThemedText variant="cardTitle">{item.label || key}</ThemedText>
          <TextInput
            value={typeof item.value === 'string' ? item.value : ''}
            onChangeText={(txt) => onChangeFilters(updateFilterValue(filters, key, txt))}
            placeholder={`Enter ${item.label || key}...`}
            placeholderTextColor={mossColors.muted}
            style={styles.input}
          />
        </View>
      );
    }

    if (kind === 'switch') {
      return (
        <View key={key} style={styles.switchRow}>
          <ThemedText variant="cardTitle" style={{ flex: 1 }}>
            {item.label || key}
          </ThemedText>
          <Switch
            value={Boolean(item.value)}
            onValueChange={(v) => onChangeFilters(updateFilterValue(filters, key, v))}
            trackColor={{ false: mossColors.surfaceElevated, true: mossColors.accent }}
            thumbColor={Boolean(item.value) ? mossColors.accentFg : mossColors.fg}
          />
        </View>
      );
    }

    const options = Array.isArray(item.options) ? item.options : [];
    const isLarge = options.length > 10;
    const isExpanded = !isLarge || Boolean(expandedGroups[key]);

    if (kind === 'picker') {
      const selectedVal = typeof item.value === 'string' ? item.value : '';
      const selectedLabel = options.find((o) => o.value === selectedVal)?.label;
      return (
        <View key={key} style={styles.filterSection}>
          <Pressable
            onPress={() => isLarge && toggleGroup(key)}
            style={styles.groupHeader}
          >
            <View style={{ flex: 1 }}>
              <ThemedText variant="cardTitle">{item.label || key}</ThemedText>
              {selectedLabel ? (
                <ThemedText variant="caption" style={{ color: mossColors.accent }}>
                  {selectedLabel}
                </ThemedText>
              ) : null}
            </View>
            {isLarge ? (
              isExpanded ? (
                <ChevronDown size={16} color={mossColors.muted} strokeWidth={1.8} />
              ) : (
                <ChevronRight size={16} color={mossColors.muted} strokeWidth={1.8} />
              )
            ) : null}
          </Pressable>

          {isExpanded ? (
            <View style={styles.optionWrap}>
              {options.map((opt) => (
                <Chip
                  key={`${key}-${opt.value}`}
                  label={opt.label}
                  active={selectedVal === opt.value}
                  onPress={() => onChangeFilters(updateFilterValue(filters, key, opt.value))}
                />
              ))}
            </View>
          ) : null}
        </View>
      );
    }

    if (kind === 'checkbox') {
      const selectedArr = Array.isArray(item.value) ? item.value : [];
      return (
        <View key={key} style={styles.filterSection}>
          <Pressable
            onPress={() => isLarge && toggleGroup(key)}
            style={styles.groupHeader}
          >
            <View style={{ flex: 1 }}>
              <ThemedText variant="cardTitle">{item.label || key}</ThemedText>
              <ThemedText variant="caption">
                {selectedArr.length > 0 ? `${selectedArr.length} selected` : `${options.length} options`}
              </ThemedText>
            </View>
            {isLarge ? (
              isExpanded ? (
                <ChevronDown size={16} color={mossColors.muted} strokeWidth={1.8} />
              ) : (
                <ChevronRight size={16} color={mossColors.muted} strokeWidth={1.8} />
              )
            ) : null}
          </Pressable>

          {isExpanded ? (
            <View style={styles.optionWrap}>
              {options.map((opt) => (
                <Chip
                  key={`${key}-${opt.value}`}
                  label={opt.label}
                  active={selectedArr.includes(opt.value)}
                  onPress={() => onChangeFilters(toggleCheckboxOption(filters, key, opt.value))}
                />
              ))}
            </View>
          ) : null}
        </View>
      );
    }

    // Tri-state ExcludableCheckboxGroup (tap: neutral -> include -> exclude -> neutral)
    const exVal =
      item.value && typeof item.value === 'object' && !Array.isArray(item.value)
        ? item.value
        : { include: [], exclude: [] };
    const incCount = exVal.include?.length ?? 0;
    const excCount = exVal.exclude?.length ?? 0;

    return (
      <View key={key} style={styles.filterSection}>
        <Pressable onPress={() => isLarge && toggleGroup(key)} style={styles.groupHeader}>
          <View style={{ flex: 1 }}>
            <ThemedText variant="cardTitle">{item.label || key}</ThemedText>
            <ThemedText variant="caption">
              {incCount > 0 || excCount > 0
                ? `+${incCount} include · -${excCount} exclude`
                : `Tap once to include, twice to exclude (${options.length})`}
            </ThemedText>
          </View>
          {isLarge ? (
            isExpanded ? (
              <ChevronDown size={16} color={mossColors.muted} strokeWidth={1.8} />
            ) : (
              <ChevronRight size={16} color={mossColors.muted} strokeWidth={1.8} />
            )
          ) : null}
        </Pressable>

        {isExpanded ? (
          <View style={styles.optionWrap}>
            {options.map((opt) => {
              const st = getExcludableOptionState(item, opt.value);
              return (
                <Pressable
                  key={`${key}-${opt.value}`}
                  onPress={() => onChangeFilters(cycleExcludableOption(filters, key, opt.value))}
                  style={({ pressed }) => [
                    styles.triChip,
                    st === 'include' && styles.triInclude,
                    st === 'exclude' && styles.triExclude,
                    pressed && { transform: [{ scale: motion.pressScale }] },
                  ]}
                >
                  {st === 'include' ? (
                    <Plus size={12} color={mossColors.accentFg} strokeWidth={2.2} />
                  ) : st === 'exclude' ? (
                    <Minus size={12} color={mossColors.fg} strokeWidth={2.2} />
                  ) : null}
                  <ThemedText
                    variant="caption"
                    style={{
                      color:
                        st === 'include'
                          ? mossColors.accentFg
                          : st === 'exclude'
                          ? mossColors.fg
                          : mossColors.muted,
                    }}
                  >
                    {opt.label}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <ThemedText variant="sectionTitle" numberOfLines={1}>
                {sourceName} Filters
              </ThemedText>
              <ThemedText variant="caption">
                {entries.length} site filter{entries.length === 1 ? '' : 's'} available
              </ThemedText>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Reset filters"
              onPress={onReset}
              style={styles.iconBtn}
            >
              <RotateCcw size={16} color={mossColors.muted} strokeWidth={1.8} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close filters"
              onPress={onClose}
              style={styles.iconBtn}
            >
              <X size={18} color={mossColors.muted} strokeWidth={1.8} />
            </Pressable>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.body}
            showsVerticalScrollIndicator={false}
          >
            {!hideLatestToggle && onChangeShowLatest ? (
              <View style={styles.switchRow}>
                <View style={{ flex: 1 }}>
                  <ThemedText variant="cardTitle">Sort by Latest Updates</ThemedText>
                  <ThemedText variant="caption">Switch between Popular catalog and Latest releases</ThemedText>
                </View>
                <Switch
                  value={showLatestNovels}
                  onValueChange={onChangeShowLatest}
                  trackColor={{ false: mossColors.surfaceElevated, true: mossColors.good }}
                  thumbColor={mossColors.fg}
                />
              </View>
            ) : null}

            {entries.length === 0 ? (
              <ThemedText variant="subhead" style={styles.emptyNote}>
                This source does not expose extra manual filters beyond Popular, Latest, and keyword search.
              </ThemedText>
            ) : (
              entries.map(([key, item]) => renderFilterControl(key, item))
            )}
          </ScrollView>

          <View style={styles.footer}>
            <Button title="Reset" variant="ghost" onPress={onReset} style={{ flex: 1 }} />
            <Button
              testID="source-filter-apply"
              title="Apply Filters"
              onPress={() => {
                onApply();
                onClose();
              }}
              style={{ flex: 2 }}
            />
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
    paddingHorizontal: spacing.md,
    paddingTop: spacing.smd,
    paddingBottom: spacing.lg,
    maxHeight: '86%',
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: radius.full,
    backgroundColor: mossColors.border,
    alignSelf: 'center',
    marginBottom: spacing.smd,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.smd,
  },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    backgroundColor: mossColors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    flexGrow: 0,
  },
  body: {
    gap: spacing.md,
    paddingBottom: spacing.lg,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.smd,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: mossColors.border,
  },
  filterSection: {
    gap: spacing.sm,
    paddingBottom: spacing.smd,
    borderBottomWidth: 1,
    borderBottomColor: mossColors.border,
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  optionWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  input: {
    backgroundColor: mossColors.surface,
    color: mossColors.fg,
    borderRadius: radius.md,
    paddingHorizontal: spacing.smd,
    paddingVertical: spacing.sm + 2,
    fontSize: 14,
  },
  triChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: spacing.xs + 3,
    paddingHorizontal: spacing.smd,
    borderRadius: radius.full,
    backgroundColor: mossColors.surface,
  },
  triInclude: {
    backgroundColor: mossColors.good,
  },
  triExclude: {
    backgroundColor: mossColors.danger,
  },
  emptyNote: {
    paddingVertical: spacing.md,
  },
  footer: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingTop: spacing.smd,
    borderTopWidth: 1,
    borderTopColor: mossColors.border,
  },
});

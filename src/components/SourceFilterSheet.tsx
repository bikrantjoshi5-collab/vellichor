import React, { useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  View,
} from 'react-native';
import {
  ChevronDown,
  ChevronRight,
  Minus,
  Plus,
  RotateCcw,
  Search,
  X,
} from 'lucide-react-native';
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
  baseFilters?: PluginFilters;
  showLatestNovels?: boolean;
  hideLatestToggle?: boolean;
  onChangeFilters: (next: PluginFilters) => void;
  onChangeShowLatest?: (next: boolean) => void;
  onReset: () => void;
  onApply: () => void;
  onClose: () => void;
}

interface ActiveBadge {
  filterKey: string;
  label: string;
  clear: () => void;
}

function getGroupSelectionCount(item: PluginFilterItem, baseItem?: PluginFilterItem): number {
  const kind = normalizeFilterKind(item.type);
  if (kind === 'checkbox') {
    return Array.isArray(item.value) ? item.value.length : 0;
  }
  if (kind === 'xcheckbox') {
    const val =
      item.value && typeof item.value === 'object' && !Array.isArray(item.value)
        ? item.value
        : { include: [], exclude: [] };
    return (val.include?.length ?? 0) + (val.exclude?.length ?? 0);
  }
  if (kind === 'switch') {
    return Boolean(item.value) !== Boolean(baseItem?.value) ? 1 : 0;
  }
  if (kind === 'text') {
    return typeof item.value === 'string' && item.value.trim().length > 0 ? 1 : 0;
  }
  if (kind === 'picker') {
    const baseVal = baseItem ? String(baseItem.value ?? '') : '';
    const currVal = String(item.value ?? '');
    return currVal !== baseVal && currVal.length > 0 ? 1 : 0;
  }
  return 0;
}

export function SourceFilterSheet({
  visible,
  sourceName,
  filters,
  baseFilters,
  showLatestNovels = false,
  hideLatestToggle = false,
  onChangeFilters,
  onChangeShowLatest,
  onReset,
  onApply,
  onClose,
}: SourceFilterSheetProps) {
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [filterSearch, setFilterSearch] = useState('');

  const entries = useMemo(() => Object.entries(filters), [filters]);
  const queryLower = filterSearch.trim().toLowerCase();

  // Collect concise active filter summary pills so users can see & clear selections in 1 tap
  const activeBadges = useMemo<ActiveBadge[]>(() => {
    const list: ActiveBadge[] = [];
    for (const [key, item] of entries) {
      const kind = normalizeFilterKind(item.type);
      const baseItem = baseFilters?.[key];
      const options = Array.isArray(item.options) ? item.options : [];
      const optLabel = (val: string) => options.find((o) => o.value === val)?.label ?? val;

      if (kind === 'picker') {
        const curr = String(item.value ?? '');
        const base = String(baseItem?.value ?? '');
        if (curr && curr !== base) {
          list.push({
            filterKey: key,
            label: `${item.label || key}: ${optLabel(curr)}`,
            clear: () => onChangeFilters(updateFilterValue(filters, key, base)),
          });
        }
      } else if (kind === 'checkbox' && Array.isArray(item.value)) {
        for (const v of item.value) {
          list.push({
            filterKey: `${key}-${v}`,
            label: optLabel(v),
            clear: () => onChangeFilters(toggleCheckboxOption(filters, key, v)),
          });
        }
      } else if (kind === 'xcheckbox' && item.value && typeof item.value === 'object' && !Array.isArray(item.value)) {
        for (const v of item.value.include ?? []) {
          list.push({
            filterKey: `${key}-inc-${v}`,
            label: `+ ${optLabel(v)}`,
            clear: () => {
              const nextInc = (item.value as { include?: string[]; exclude?: string[] }).include?.filter((x) => x !== v) ?? [];
              const nextExc = (item.value as { include?: string[]; exclude?: string[] }).exclude ?? [];
              onChangeFilters(updateFilterValue(filters, key, { include: nextInc, exclude: nextExc }));
            },
          });
        }
        for (const v of item.value.exclude ?? []) {
          list.push({
            filterKey: `${key}-exc-${v}`,
            label: `− ${optLabel(v)}`,
            clear: () => {
              const nextInc = (item.value as { include?: string[]; exclude?: string[] }).include ?? [];
              const nextExc = (item.value as { include?: string[]; exclude?: string[] }).exclude?.filter((x) => x !== v) ?? [];
              onChangeFilters(updateFilterValue(filters, key, { include: nextInc, exclude: nextExc }));
            },
          });
        }
      } else if (kind === 'text' && typeof item.value === 'string' && item.value.trim()) {
        list.push({
          filterKey: key,
          label: `${item.label || key}: ${item.value.trim()}`,
          clear: () => onChangeFilters(updateFilterValue(filters, key, '')),
        });
      } else if (kind === 'switch' && Boolean(item.value) !== Boolean(baseItem?.value)) {
        list.push({
          filterKey: key,
          label: `${item.label || key}: ${item.value ? 'On' : 'Off'}`,
          clear: () => onChangeFilters(updateFilterValue(filters, key, Boolean(baseItem?.value))),
        });
      }
    }
    return list;
  }, [entries, baseFilters, filters, onChangeFilters]);

  const toggleGroup = (key: string, defaultExpanded: boolean) => {
    setExpandedGroups((prev) => {
      const current = prev[key] !== undefined ? prev[key] : defaultExpanded;
      return { ...prev, [key]: !current };
    });
  };

  const renderFilterControl = (key: string, item: PluginFilterItem, idx: number) => {
    const kind = normalizeFilterKind(item.type);
    const title = item.label || key;
    const titleMatches = !queryLower || title.toLowerCase().includes(queryLower);
    const allOptions = Array.isArray(item.options) ? item.options : [];
    const visibleOptions = queryLower
      ? titleMatches
        ? allOptions
        : allOptions.filter((o) => o.label.toLowerCase().includes(queryLower))
      : allOptions;

    // Hide completely unrelated sections during search
    if (queryLower && !titleMatches && visibleOptions.length === 0) {
      return null;
    }

    const activeCount = getGroupSelectionCount(item, baseFilters?.[key]);
    const defaultExpanded = idx < 2 || allOptions.length <= 12 || activeCount > 0;
    const isExpanded =
      queryLower.length > 0
        ? true
        : expandedGroups[key] !== undefined
        ? expandedGroups[key]
        : defaultExpanded;

    if (kind === 'text') {
      return (
        <View key={key} style={styles.filterCard}>
          <ThemedText variant="cardTitle">{title}</ThemedText>
          <TextInput
            value={typeof item.value === 'string' ? item.value : ''}
            onChangeText={(txt) => onChangeFilters(updateFilterValue(filters, key, txt))}
            placeholder={`Type ${title}...`}
            placeholderTextColor={mossColors.muted}
            style={styles.input}
          />
        </View>
      );
    }

    if (kind === 'switch') {
      return (
        <View key={key} style={styles.filterCardRow}>
          <ThemedText variant="cardTitle" style={{ flex: 1 }}>
            {title}
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

    if (kind === 'picker') {
      const selectedVal = typeof item.value === 'string' ? item.value : '';
      const selectedLabel = allOptions.find((o) => o.value === selectedVal)?.label;
      return (
        <View key={key} style={styles.filterCard}>
          <Pressable onPress={() => toggleGroup(key, defaultExpanded)} style={styles.groupHeader}>
            <View style={{ flex: 1, gap: 2 }}>
              <ThemedText variant="cardTitle">{title}</ThemedText>
              <ThemedText
                variant="caption"
                style={{ color: selectedLabel ? mossColors.accent : mossColors.muted }}
                numberOfLines={1}
              >
                {selectedLabel || `${allOptions.length} choices`}
              </ThemedText>
            </View>
            {isExpanded ? (
              <ChevronDown size={16} color={mossColors.muted} strokeWidth={1.8} />
            ) : (
              <ChevronRight size={16} color={mossColors.muted} strokeWidth={1.8} />
            )}
          </Pressable>

          {isExpanded ? (
            <View style={styles.optionWrap}>
              {visibleOptions.map((opt) => (
                <Chip
                  key={`${key}-${opt.value}`}
                  label={opt.label}
                  active={selectedVal === opt.value}
                  onPress={() => onChangeFilters(updateFilterValue(filters, key, opt.value))}
                  style={selectedVal === opt.value ? undefined : styles.nestedChip}
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
        <View key={key} style={styles.filterCard}>
          <Pressable onPress={() => toggleGroup(key, defaultExpanded)} style={styles.groupHeader}>
            <View style={{ flex: 1, gap: 2 }}>
              <View style={styles.titleBadgeRow}>
                <ThemedText variant="cardTitle">{title}</ThemedText>
                {selectedArr.length > 0 ? (
                  <View style={styles.countBadge}>
                    <ThemedText variant="mono" style={{ color: mossColors.accentFg, fontSize: 10 }}>
                      {selectedArr.length}
                    </ThemedText>
                  </View>
                ) : null}
              </View>
              <ThemedText variant="caption">
                {selectedArr.length > 0
                  ? `${selectedArr.length} selected · ${allOptions.length} total`
                  : `Select any (${allOptions.length} options)`}
              </ThemedText>
            </View>
            {isExpanded ? (
              <ChevronDown size={16} color={mossColors.muted} strokeWidth={1.8} />
            ) : (
              <ChevronRight size={16} color={mossColors.muted} strokeWidth={1.8} />
            )}
          </Pressable>

          {isExpanded ? (
            <View style={styles.optionWrap}>
              {visibleOptions.map((opt) => (
                <Chip
                  key={`${key}-${opt.value}`}
                  label={opt.label}
                  active={selectedArr.includes(opt.value)}
                  onPress={() => onChangeFilters(toggleCheckboxOption(filters, key, opt.value))}
                  style={selectedArr.includes(opt.value) ? undefined : styles.nestedChip}
                />
              ))}
            </View>
          ) : null}
        </View>
      );
    }

    // Tri-state ExcludableCheckboxGroup (tap once = include, twice = exclude, third = neutral)
    const exVal =
      item.value && typeof item.value === 'object' && !Array.isArray(item.value)
        ? item.value
        : { include: [], exclude: [] };
    const incCount = exVal.include?.length ?? 0;
    const excCount = exVal.exclude?.length ?? 0;

    return (
      <View key={key} style={styles.filterCard}>
        <Pressable onPress={() => toggleGroup(key, defaultExpanded)} style={styles.groupHeader}>
          <View style={{ flex: 1, gap: 2 }}>
            <View style={styles.titleBadgeRow}>
              <ThemedText variant="cardTitle">{title}</ThemedText>
              {incCount + excCount > 0 ? (
                <View style={styles.countBadge}>
                  <ThemedText variant="mono" style={{ color: mossColors.accentFg, fontSize: 10 }}>
                    {incCount + excCount}
                  </ThemedText>
                </View>
              ) : null}
            </View>
            <ThemedText variant="caption">
              {incCount > 0 || excCount > 0
                ? `+${incCount} include · −${excCount} exclude`
                : `1st tap Include (+) · 2nd tap Exclude (−) · ${allOptions.length} tags`}
            </ThemedText>
          </View>
          {isExpanded ? (
            <ChevronDown size={16} color={mossColors.muted} strokeWidth={1.8} />
          ) : (
            <ChevronRight size={16} color={mossColors.muted} strokeWidth={1.8} />
          )}
        </Pressable>

        {isExpanded ? (
          <View style={styles.optionWrap}>
            {visibleOptions.map((opt) => {
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
                {entries.length} filter group{entries.length === 1 ? '' : 's'} · {activeBadges.length} active
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

          {/* Fast Filter Search Bar — find any genre, status, or sort option instantly */}
          {entries.length > 0 ? (
            <View style={styles.searchBar}>
              <Search size={15} color={mossColors.muted} strokeWidth={1.8} />
              <TextInput
                testID="source-filter-search"
                value={filterSearch}
                onChangeText={setFilterSearch}
                placeholder="Quick find genre, tag, status, or sort..."
                placeholderTextColor={mossColors.muted}
                style={styles.searchInput}
              />
              {filterSearch.length > 0 ? (
                <Pressable onPress={() => setFilterSearch('')} hitSlop={6}>
                  <X size={15} color={mossColors.muted} strokeWidth={1.8} />
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {/* Active Filters Strip — see everything active at a glance & tap × to remove */}
          {activeBadges.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.activeStripWrap}
              contentContainerStyle={styles.activeStrip}
            >
              {activeBadges.map((badge) => (
                <Pressable
                  key={badge.filterKey}
                  onPress={badge.clear}
                  style={styles.activePill}
                >
                  <ThemedText variant="caption" style={{ color: mossColors.accentFg }} numberOfLines={1}>
                    {badge.label}
                  </ThemedText>
                  <X size={12} color={mossColors.accentFg} strokeWidth={2.2} />
                </Pressable>
              ))}
            </ScrollView>
          ) : null}

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.body}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {!hideLatestToggle && onChangeShowLatest ? (
              <View style={styles.filterCardRow}>
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
              entries.map(([key, item], idx) => renderFilterControl(key, item, idx))
            )}
          </ScrollView>

          <View style={styles.footer}>
            <Button title="Reset All" variant="ghost" onPress={onReset} style={{ flex: 1 }} />
            <Button
              testID="source-filter-apply"
              title={activeBadges.length > 0 ? `Apply Filters (${activeBadges.length})` : 'Apply Filters'}
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
    maxHeight: '88%',
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
    marginBottom: spacing.sm,
  },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    backgroundColor: mossColors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.smd,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.md,
    backgroundColor: mossColors.surface,
    marginBottom: spacing.sm,
  },
  searchInput: {
    flex: 1,
    color: mossColors.fg,
    fontSize: 13.5,
    paddingVertical: spacing.xs,
  },
  activeStripWrap: {
    flexGrow: 0,
    marginBottom: spacing.sm,
  },
  activeStrip: {
    gap: spacing.xs + 2,
    paddingVertical: 2,
  },
  activePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: spacing.xs + 1,
    paddingHorizontal: spacing.sm + 2,
    borderRadius: radius.full,
    backgroundColor: mossColors.accent,
  },
  scroll: {
    flexGrow: 0,
  },
  body: {
    gap: spacing.sm + 2,
    paddingBottom: spacing.lg,
  },
  filterCard: {
    backgroundColor: mossColors.surface,
    borderRadius: radius.card,
    padding: spacing.smd,
    gap: spacing.sm,
  },
  filterCardRow: {
    backgroundColor: mossColors.surface,
    borderRadius: radius.card,
    padding: spacing.smd,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.smd,
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  titleBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
  },
  countBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: radius.full,
    backgroundColor: mossColors.accent,
  },
  optionWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs + 2,
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: mossColors.border,
  },
  nestedChip: {
    backgroundColor: mossColors.surfaceElevated,
  },
  input: {
    backgroundColor: mossColors.surfaceElevated,
    color: mossColors.fg,
    borderRadius: radius.md,
    paddingHorizontal: spacing.smd,
    paddingVertical: spacing.sm + 1,
    fontSize: 14,
  },
  triChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: spacing.xs + 3,
    paddingHorizontal: spacing.smd,
    borderRadius: radius.full,
    backgroundColor: mossColors.surfaceElevated,
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

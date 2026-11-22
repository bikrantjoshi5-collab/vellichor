import { FilterTypes } from './shims';
import type { ExcludableValue, PluginFilterItem, PluginFilters } from './types';

function cloneFilterItem(item: PluginFilterItem): PluginFilterItem {
  let clonedValue: PluginFilterItem['value'] = item.value;
  if (Array.isArray(item.value)) {
    clonedValue = [...item.value];
  } else if (item.value && typeof item.value === 'object') {
    const ex = item.value as ExcludableValue;
    clonedValue = {
      include: Array.isArray(ex.include) ? [...ex.include] : [],
      exclude: Array.isArray(ex.exclude) ? [...ex.exclude] : [],
    };
  }
  return {
    ...item,
    value: clonedValue,
    options: item.options ? item.options.map((o) => ({ ...o })) : undefined,
  };
}

export function cloneFilters(filters?: PluginFilters | null): PluginFilters {
  if (!filters || typeof filters !== 'object') return {};
  const out: PluginFilters = {};
  for (const [key, item] of Object.entries(filters)) {
    if (!item || typeof item !== 'object') continue;
    out[key] = cloneFilterItem(item);
  }
  return out;
}

export function resetFilters(baseFilters?: PluginFilters | null): PluginFilters {
  return cloneFilters(baseFilters);
}

export function updateFilterValue(
  filters: PluginFilters,
  key: string,
  nextValue: PluginFilterItem['value']
): PluginFilters {
  const target = filters[key];
  if (!target) return filters;
  return {
    ...filters,
    [key]: {
      ...cloneFilterItem(target),
      value: nextValue,
    },
  };
}

export function toggleCheckboxOption(
  filters: PluginFilters,
  key: string,
  optionValue: string
): PluginFilters {
  const target = filters[key];
  if (!target) return filters;
  const current = Array.isArray(target.value) ? [...target.value] : [];
  const idx = current.indexOf(optionValue);
  if (idx >= 0) current.splice(idx, 1);
  else current.push(optionValue);
  return updateFilterValue(filters, key, current);
}

/**
 * Tri-state cycle for LNReader ExcludableCheckboxGroup:
 * neutral -> include -> exclude -> neutral
 */
export function cycleExcludableOption(
  filters: PluginFilters,
  key: string,
  optionValue: string
): PluginFilters {
  const target = filters[key];
  if (!target) return filters;
  const raw = (target.value && typeof target.value === 'object' && !Array.isArray(target.value)
    ? target.value
    : {}) as ExcludableValue;
  const include = Array.isArray(raw.include) ? [...raw.include] : [];
  const exclude = Array.isArray(raw.exclude) ? [...raw.exclude] : [];

  const inInc = include.indexOf(optionValue);
  const inExc = exclude.indexOf(optionValue);

  if (inInc >= 0) {
    include.splice(inInc, 1);
    exclude.push(optionValue);
  } else if (inExc >= 0) {
    exclude.splice(inExc, 1);
  } else {
    include.push(optionValue);
  }

  return updateFilterValue(filters, key, { include, exclude });
}

export function getExcludableOptionState(
  item: PluginFilterItem,
  optionValue: string
): 'neutral' | 'include' | 'exclude' {
  if (!item.value || typeof item.value !== 'object' || Array.isArray(item.value)) {
    return 'neutral';
  }
  const ex = item.value as ExcludableValue;
  if (ex.include?.includes(optionValue)) return 'include';
  if (ex.exclude?.includes(optionValue)) return 'exclude';
  return 'neutral';
}

export function normalizeFilterKind(
  type: string
): 'text' | 'picker' | 'switch' | 'checkbox' | 'xcheckbox' {
  const t = String(type || '').toLowerCase();
  if (t === FilterTypes.ExcludableCheckboxGroup.toLowerCase() || t.includes('exclud')) return 'xcheckbox';
  if (t === FilterTypes.CheckboxGroup.toLowerCase() || t.includes('check')) return 'checkbox';
  if (t === FilterTypes.Picker.toLowerCase() || t.includes('pick') || t.includes('select')) return 'picker';
  if (t === FilterTypes.Switch.toLowerCase() || t.includes('switch') || t.includes('bool')) return 'switch';
  return 'text';
}

export function countActiveFilters(current: PluginFilters, baseline?: PluginFilters | null): number {
  let active = 0;
  for (const [key, item] of Object.entries(current)) {
    const baseVal = baseline?.[key]?.value;
    const val = item.value;
    if (Array.isArray(val)) {
      const baseArr = Array.isArray(baseVal) ? baseVal : [];
      if (val.length !== baseArr.length || val.some((x) => !baseArr.includes(x))) active++;
    } else if (val && typeof val === 'object') {
      const ex = val as ExcludableValue;
      const incLen = ex.include?.length ?? 0;
      const excLen = ex.exclude?.length ?? 0;
      if (incLen > 0 || excLen > 0) active++;
    } else if (val !== baseVal && val !== '' && val !== false) {
      active++;
    }
  }
  return active;
}

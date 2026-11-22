export interface RawVoiceLike {
  identifier: string;
  name?: string;
  language?: string;
  quality?: string;
}

export interface CleanVoiceOption {
  identifier: string;
  displayName: string;
  subtitle: string;
  language: string;
  isNeural: boolean;
  score: number;
}

export const TTS_SPEED_PRESETS = [0.75, 0.9, 1.0, 1.15, 1.25, 1.5, 1.75, 2.0] as const;

export const TTS_PITCH_PRESETS = [
  { label: 'Deep', value: 0.9 },
  { label: 'Natural', value: 1.0 },
  { label: 'Bright', value: 1.08 },
] as const;

// Friendly persona labels for Google/Android neural voice codes so users pick clean voices easily.
const KNOWN_ANDROID_PERSONAS: Record<string, string> = {
  tpf: 'Clara · Warm Narrator',
  iol: 'Arthur · Deep Studio',
  iob: 'Hannah · Soft Clear',
  tpc: 'Maya · Crisp Story',
  tpd: 'Liam · Calm Studio',
  iom: 'Noah · Steady Baritone',
  gba: 'Eleanor · British Clear',
  gbb: 'Oliver · British Warm',
  gbc: 'Charlotte · British Soft',
  gbd: 'George · British Deep',
  rjs: 'James · British Studio',
  fis: 'Sophie · British Bright',
  aub: 'Chloe · Australian Clear',
  aud: 'Jack · Australian Calm',
  sfg: 'Classic US · Offline',
};

function regionLabel(lang: string): string {
  const lower = lang.toLowerCase();
  if (lower.includes('en-us') || lower.includes('en_us')) return 'US English';
  if (lower.includes('en-gb') || lower.includes('en_gb')) return 'UK English';
  if (lower.includes('en-au') || lower.includes('en_au')) return 'AU English';
  if (lower.includes('en-in') || lower.includes('en_in')) return 'IN English';
  if (lower.includes('en-ca') || lower.includes('en_ca')) return 'CA English';
  return lang.toUpperCase();
}

function buildFriendlyName(v: RawVoiceLike, index: number, isNeural: boolean): string {
  const idLower = v.identifier.toLowerCase();
  const codeMatch = idLower.match(/-x-([a-z0-9]{2,5})-/);
  if (codeMatch && KNOWN_ANDROID_PERSONAS[codeMatch[1]]) {
    return KNOWN_ANDROID_PERSONAS[codeMatch[1]];
  }
  // If the OS already gave a readable name (not raw `en-us-x-...` id), keep it clean
  if (v.name && !/^[a-z]{2}[-_][a-z]{2}[-_]x[-_]/i.test(v.name) && v.name.length <= 28) {
    return v.name;
  }
  const region = regionLabel(v.language || 'en-US').replace(' English', '');
  return isNeural ? `${region} Studio Voice ${index + 1}` : `${region} Offline Voice ${index + 1}`;
}

export function rankAndLabelVoices(
  rawVoices: RawVoiceLike[],
  opts: { includeAllLanguages?: boolean; maxCount?: number } = {}
): CleanVoiceOption[] {
  const includeAll = opts.includeAllLanguages ?? false;
  const maxCount = opts.maxCount ?? 18;
  const seen = new Set<string>();

  const filtered = rawVoices.filter((v) => {
    if (!v?.identifier || seen.has(v.identifier)) return false;
    seen.add(v.identifier);
    if (includeAll) return true;
    return (v.language || '').toLowerCase().startsWith('en');
  });

  const scored = filtered.map((v, idx) => {
    const idLower = v.identifier.toLowerCase();
    const qualLower = (v.quality || '').toLowerCase();
    const isEnhanced = qualLower.includes('enhanced') || idLower.includes('enhanced') || idLower.includes('neural');
    const isNetwork = idLower.includes('network');
    const isNeural = isEnhanced || isNetwork;
    const isKnownNatural = /-x-(tpf|iol|iob|tpc|tpd|iom|gba|gbb|gbc|gbd|rjs|aub)-/.test(idLower);

    let score = 0;
    if (isEnhanced) score += 50;
    if (isNetwork) score += 35;
    if (isKnownNatural) score += 25;
    if ((v.language || '').toLowerCase().includes('en-us') || (v.language || '').toLowerCase().includes('en-gb')) {
      score += 10;
    }

    const region = regionLabel(v.language || 'en-US');
    const subtitle = `${region} · ${isNeural ? 'HD Natural' : 'Offline'}`;

    return {
      identifier: v.identifier,
      displayName: buildFriendlyName(v, idx, isNeural),
      subtitle,
      language: v.language || 'en-US',
      isNeural,
      score,
    };
  });

  scored.sort((a, b) => b.score - a.score || a.displayName.localeCompare(b.displayName));
  return scored.slice(0, maxCount);
}

/**
 * Cleans chapter text so Android TTS reads smoothly without spelling out decorative dividers,
 * translator bracket tags, or awkward punctuation bursts.
 */
export function sanitizeForSpeech(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  // Skip pure decorative scene dividers like ***, ---, ===, ~~~, • • •
  if (/^[\s*\-=_~•·#<>]+$/.test(trimmed)) return '';

  return trimmed
    .replace(/\[(?:tl|tn|ed|pr|note)\s*:[^\]]*\]/gi, '')
    .replace(/[—–]/g, ', ')
    .replace(/[*_~`]+/g, '')
    .replace(/\s+([,.;!?])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

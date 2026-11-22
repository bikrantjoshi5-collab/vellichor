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
  { label: 'Deep', value: 0.92 },
  { label: 'Natural', value: 1.0 },
  { label: 'Bright', value: 1.06 },
] as const;

// Rich, natural-sounding persona labels for modern Google/Android WaveNet & Neural2 voices.
const KNOWN_ANDROID_PERSONAS: Record<string, { name: string; style: string }> = {
  tpf: { name: 'Clara', style: 'Warm Storyteller' },
  iol: { name: 'Arthur', style: 'Deep Studio' },
  tpd: { name: 'Liam', style: 'Calm Narrator' },
  iob: { name: 'Hannah', style: 'Soft & Clear' },
  tpc: { name: 'Maya', style: 'Crisp Fiction' },
  iom: { name: 'Noah', style: 'Steady Baritone' },
  iog: { name: 'Evelyn', style: 'Smooth & Warm' },
  ioh: { name: 'Lucas', style: 'Natural Conversational' },
  iok: { name: 'Grace', style: 'Expressive Clear' },
  sfb: { name: 'Nora', style: 'Studio Warm' },
  sfc: { name: 'Julian', style: 'Studio Calm' },
  sfd: { name: 'Elena', style: 'Bright Natural' },
  sfe: { name: 'Caleb', style: 'Deep Relaxed' },
  afg: { name: 'Iris', style: 'Soft Narrative' },
  gba: { name: 'Eleanor', style: 'British Clear' },
  gbb: { name: 'Oliver', style: 'British Warm' },
  gbc: { name: 'Charlotte', style: 'British Soft' },
  gbd: { name: 'George', style: 'British Deep' },
  gbg: { name: 'Amelia', style: 'British Expressive' },
  rjs: { name: 'James', style: 'British Classic' },
  fis: { name: 'Sophie', style: 'British Bright' },
  aub: { name: 'Chloe', style: 'Australian Clear' },
  aud: { name: 'Jack', style: 'Australian Calm' },
  auc: { name: 'Isla', style: 'Australian Warm' },
  aua: { name: 'Ruby', style: 'Australian Crisp' },
  end: { name: 'Priya', style: 'Indian Warm' },
  ene: { name: 'Arjun', style: 'Indian Clear' },
  enc: { name: 'Ananya', style: 'Indian Soft' },
  ahp: { name: 'Rohan', style: 'Indian Deep' },
};

// Old/blurry/robotic legacy Android voice identifiers that should be stripped out.
const LEGACY_BLURRY_PATTERNS = [
  /-local$/i,
  /-language$/i,
  /-x-sfg-/i,
  /espeak/i,
  /pico/i,
  /compact/i,
  /legacy/i,
  /svox/i,
];

export function isLegacyBlurryVoice(identifier: string, quality?: string): boolean {
  const idLower = identifier.toLowerCase();
  const qualLower = (quality || '').toLowerCase();
  if (qualLower.includes('low')) return true;
  // Network & explicit neural/enhanced voices are crisp HD models
  if (idLower.includes('network') || idLower.includes('neural') || idLower.includes('wavenet')) {
    return false;
  }
  return LEGACY_BLURRY_PATTERNS.some((re) => re.test(idLower));
}

function extractPersonaKey(v: RawVoiceLike): string {
  const idLower = v.identifier.toLowerCase();
  const match = idLower.match(/^([a-z]{2}[-_][a-z]{2})[-_]x[-_]([a-z0-9]{2,5})/);
  if (match) return `${match[1]}-${match[2]}`;
  return idLower.replace(/-(network|local)$/i, '');
}

function regionLabel(lang: string): string {
  const lower = lang.toLowerCase();
  if (lower.includes('en-us') || lower.includes('en_us')) return 'US';
  if (lower.includes('en-gb') || lower.includes('en_gb')) return 'UK';
  if (lower.includes('en-au') || lower.includes('en_au')) return 'AU';
  if (lower.includes('en-in') || lower.includes('en_in')) return 'IN';
  if (lower.includes('en-ca') || lower.includes('en_ca')) return 'CA';
  if (lower.includes('en-ng') || lower.includes('en_ng')) return 'NG';
  return lang.toUpperCase();
}

function buildVoiceLabels(
  v: RawVoiceLike,
  index: number,
  isNeural: boolean
): { displayName: string; subtitle: string } {
  const idLower = v.identifier.toLowerCase();
  const region = regionLabel(v.language || 'en-US');
  const codeMatch = idLower.match(/[-_]x[-_]([a-z0-9]{2,5})/);
  if (codeMatch && KNOWN_ANDROID_PERSONAS[codeMatch[1]]) {
    const p = KNOWN_ANDROID_PERSONAS[codeMatch[1]];
    return {
      displayName: p.name,
      subtitle: `${p.style} · ${region} ${isNeural ? 'HD' : ''}`.trim(),
    };
  }
  if (v.name && !/^[a-z]{2}[-_][a-z]{2}[-_]x[-_]/i.test(v.name) && v.name.length <= 28) {
    return {
      displayName: v.name,
      subtitle: `${region} · ${isNeural ? 'HD Natural' : 'Standard'}`,
    };
  }
  return {
    displayName: `${region} Studio ${index + 1}`,
    subtitle: isNeural ? `${region} · HD Neural` : `${region} · Natural`,
  };
}

export function rankAndLabelVoices(
  rawVoices: RawVoiceLike[],
  opts: { includeAllLanguages?: boolean; maxCount?: number } = {}
): CleanVoiceOption[] {
  const includeAll = opts.includeAllLanguages ?? false;
  const maxCount = opts.maxCount ?? 28;

  const langMatched = rawVoices.filter((v) => {
    if (!v?.identifier) return false;
    if (includeAll) return true;
    return (v.language || '').toLowerCase().startsWith('en');
  });

  // Check if the device has crisp HD / Neural / Network voices available.
  // When present, completely REMOVE old blurry `-local` / `-language` / `sfg` voices!
  const hasCrispVoices = langMatched.some((v) => !isLegacyBlurryVoice(v.identifier, v.quality));
  const pool = hasCrispVoices
    ? langMatched.filter((v) => !isLegacyBlurryVoice(v.identifier, v.quality))
    : langMatched;

  // Deduplicate by persona key so each narrator only appears ONCE (using its crispest variant).
  const bestByPersona = new Map<string, CleanVoiceOption>();

  pool.forEach((v, idx) => {
    const idLower = v.identifier.toLowerCase();
    const qualLower = (v.quality || '').toLowerCase();
    const isEnhanced =
      qualLower.includes('enhanced') ||
      idLower.includes('enhanced') ||
      idLower.includes('neural') ||
      idLower.includes('wavenet');
    const isNetwork = idLower.includes('network');
    const isNeural = isEnhanced || isNetwork;
    const codeMatch = idLower.match(/[-_]x[-_]([a-z0-9]{2,5})/);
    const isKnownNatural = Boolean(codeMatch && KNOWN_ANDROID_PERSONAS[codeMatch[1]]);
    const isLocal = idLower.includes('-local');

    let score = 0;
    if (isNetwork) score += 60;
    if (isEnhanced) score += 45;
    if (isKnownNatural) score += 30;
    if (isLocal) score -= 50;
    if ((v.language || '').toLowerCase().includes('en-us')) score += 12;
    else if ((v.language || '').toLowerCase().includes('en-gb')) score += 10;
    else if ((v.language || '').toLowerCase().includes('en-au')) score += 8;

    const { displayName, subtitle } = buildVoiceLabels(v, idx, isNeural);
    const option: CleanVoiceOption = {
      identifier: v.identifier,
      displayName,
      subtitle,
      language: v.language || 'en-US',
      isNeural,
      score,
    };

    const personaKey = extractPersonaKey(v);
    const prev = bestByPersona.get(personaKey);
    if (!prev || option.score > prev.score) {
      bestByPersona.set(personaKey, option);
    }
  });

  const ranked = Array.from(bestByPersona.values());
  ranked.sort((a, b) => b.score - a.score || a.displayName.localeCompare(b.displayName));
  return ranked.slice(0, maxCount);
}

/**
 * Picks the best natural HD voice automatically when none is chosen OR if the previously
 * saved voice was an old blurry `-local` / legacy voice.
 */
export function pickDefaultNaturalVoice(
  cleanVoices: CleanVoiceOption[],
  currentVoiceId?: string
): CleanVoiceOption | null {
  if (cleanVoices.length === 0) return null;
  if (currentVoiceId && !isLegacyBlurryVoice(currentVoiceId)) {
    const existing = cleanVoices.find((v) => v.identifier === currentVoiceId);
    if (existing) return existing;
  }
  return cleanVoices[0];
}

/**
 * Cleans chapter text so Android TTS reads naturally without spelling out decorative dividers,
 * translator bracket tags, URLs, or awkward punctuation bursts.
 */
export function sanitizeForSpeech(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (/^[\s*\-=_~•·#<>]+$/.test(trimmed)) return '';

  return trimmed
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/\[(?:tl|tn|ed|pr|note)\s*:[^\]]*\]/gi, '')
    .replace(/[—–]/g, ', ')
    .replace(/\.{3,}/g, '…')
    .replace(/[*_~`]+/g, '')
    .replace(/\s+([,.;!?])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

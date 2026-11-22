export function parseSemver(version: string): [number, number, number] {
  const clean = version.trim().replace(/^v/i, '').split('-')[0];
  const parts = clean.split('.').map((p) => {
    const n = Number.parseInt(p, 10);
    return Number.isFinite(n) ? n : 0;
  });
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

export interface UpdateCheckInput {
  installedVersion: string;
  remoteVersion: string;
  installedHash?: string | null;
  remoteHash?: string | null;
}

export interface UpdateCheckResult {
  hasUpdate: boolean;
  reason: 'version' | 'hash' | 'none';
}

export function detectPluginUpdate(input: UpdateCheckInput): UpdateCheckResult {
  if (compareSemver(input.remoteVersion, input.installedVersion) > 0) {
    return { hasUpdate: true, reason: 'version' };
  }
  if (input.installedHash && input.remoteHash && input.installedHash !== input.remoteHash) {
    return { hasUpdate: true, reason: 'hash' };
  }
  return { hasUpdate: false, reason: 'none' };
}

/**
 * Deterministic 64-bit FNV-1a + length hex fingerprint for plugin bundles.
 * Pure JS so it works synchronously in both Hermes and Node without native crypto dependencies.
 */
export function hashBundleCode(code: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < code.length; i++) {
    const c = code.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= c + ((i & 0xff) << 1);
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  const part1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const part2 = (h2 >>> 0).toString(16).padStart(8, '0');
  return `${part1}${part2}-${code.length.toString(16)}`;
}

import { hashBundleCode } from './semver';

/**
 * Security guards for LNReader-compatible plugin bundles, plugin IDs, and external URLs.
 * Provides defense-in-depth against malicious plugins attempting to access native Expo bridges
 * (SecureStore, SQLite, FileSystem), Metro internals, local files, or private LAN endpoints.
 */

const SAFE_PLUGIN_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,120}$/;

const FORBIDDEN_CODE_RULES: Array<{ name: string; pattern: RegExp }> = [
  { name: 'ExpoSecureStore access', pattern: /ExpoSecureStore|expo-secure-store/i },
  { name: 'ExpoSQLite access', pattern: /ExpoSQLite|expo-sqlite/i },
  { name: 'ExponentFileSystem access', pattern: /ExponentFileSystem|expo-file-system/i },
  { name: 'React Native bridge access', pattern: /__turboModuleProxy|nativeModuleProxy|\bNativeModules\b/ },
  { name: 'Global Expo bridge access', pattern: /\b(?:globalThis|global|window|self)\s*\.\s*expo\b/i },
  { name: 'Tracker secret key reference', pattern: /vellichor_(?:anilist|mal)_/i },
  { name: 'Metro internal require escape', pattern: /\b__r\s*\(|\b__d\s*\(|metroRequire/ },
  { name: 'Dynamic eval execution', pattern: /\beval\s*\(/ },
  { name: 'Dynamic Function constructor', pattern: /\bnew\s+Function\s*\(/ },
  { name: 'Prototype constructor sandbox escape', pattern: /\.constructor\s*\(|constructor\s*\[\s*['"]constructor['"]\s*\]/ },
  { name: 'Dynamic ESM import', pattern: /\bimport\s*\(/ },
  { name: 'Node process/child_process access', pattern: /\bchild_process\b|\bprocess\s*\.\s*env\b/ },
];

const PRIVATE_OR_LOCAL_HOSTS = [
  /^localhost$/i,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^\[?::1\]?$/,
  /\.local$/i,
];

export function assertSafePluginId(pluginId: string): string {
  const clean = String(pluginId ?? '').trim();
  if (!SAFE_PLUGIN_ID_RE.test(clean) || clean.includes('..') || clean.includes('/') || clean.includes('\\')) {
    throw new Error(`Rejected unsafe plugin ID "${pluginId}"`);
  }
  return clean;
}

export function auditPluginCode(code: string, pluginId: string): void {
  if (typeof code !== 'string' || code.trim().length === 0) {
    throw new Error(`Plugin "${pluginId}" bundle is empty`);
  }
  for (const rule of FORBIDDEN_CODE_RULES) {
    if (rule.pattern.test(code)) {
      throw new Error(
        `Security check blocked plugin "${pluginId}": forbidden ${rule.name}`
      );
    }
  }
}

const BLOCKED_TRACKER_HOSTS = new Set([
  'graphql.anilist.co',
  'anilist.co',
  'api.myanimelist.net',
  'myanimelist.net',
]);

export function assertSafeExternalUrl(
  rawUrl: string,
  context = 'request',
  opts: { blockTrackerApis?: boolean } = {}
): string {
  const trimmed = String(rawUrl ?? '').trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`Blocked invalid URL in ${context}`);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`Blocked non-HTTP(S) URL scheme "${parsed.protocol}" in ${context}`);
  }
  const host = parsed.hostname.toLowerCase();
  if (!host || PRIVATE_OR_LOCAL_HOSTS.some((re) => re.test(host))) {
    throw new Error(`Blocked local/private network host "${host}" in ${context}`);
  }
  if (opts.blockTrackerApis && BLOCKED_TRACKER_HOSTS.has(host)) {
    throw new Error(`Blocked tracker API host "${host}" from ${context}`);
  }
  return parsed.toString();
}

async function digestHex(algorithm: 'SHA-256' | 'SHA-1' | 'MD5', text: string): Promise<string> {
  try {
    // React Native / Expo native crypto
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ExpoCrypto = require('expo-crypto') as typeof import('expo-crypto');
    const algMap: Record<'SHA-256' | 'SHA-1' | 'MD5', import('expo-crypto').CryptoDigestAlgorithm> = {
      'SHA-256': ExpoCrypto.CryptoDigestAlgorithm.SHA256,
      'SHA-1': ExpoCrypto.CryptoDigestAlgorithm.SHA1,
      MD5: ExpoCrypto.CryptoDigestAlgorithm.MD5,
    };
    if (typeof ExpoCrypto.digestStringAsync === 'function') {
      return (await ExpoCrypto.digestStringAsync(algMap[algorithm], text)).toLowerCase();
    }
  } catch {
    // Fall through to Node crypto in Jest / Node environments
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeCrypto = require('crypto') as typeof import('crypto');
  const nodeAlg = algorithm === 'SHA-256' ? 'sha256' : algorithm === 'SHA-1' ? 'sha1' : 'md5';
  return nodeCrypto.createHash(nodeAlg).update(text, 'utf8').digest('hex').toLowerCase();
}

/**
 * Verifies downloaded plugin code against the manifest's declared hash before writing to disk.
 * Supports SHA-256 (64 hex, optional `sha256:` prefix), SHA-1 (40 hex), MD5 (32 hex),
 * and Vellichor's FNV bundle fingerprint. Rejects any tampered or mismatched bundle.
 */
export async function verifyBundleIntegrity(
  code: string,
  expectedHash: string | null | undefined,
  pluginId: string
): Promise<void> {
  if (!expectedHash || !expectedHash.trim()) return;

  const raw = expectedHash.trim().toLowerCase();
  const normalized = raw.replace(/^(?:sha-?256|sha-?1|md5):/i, '');

  let actual: string;
  if (/^[0-9a-f]{64}$/.test(normalized)) {
    actual = await digestHex('SHA-256', code);
  } else if (/^[0-9a-f]{40}$/.test(normalized)) {
    actual = await digestHex('SHA-1', code);
  } else if (/^[0-9a-f]{32}$/.test(normalized)) {
    actual = await digestHex('MD5', code);
  } else {
    actual = hashBundleCode(code).toLowerCase();
  }

  if (actual !== normalized) {
    throw new Error(
      `Integrity check failed for plugin "${pluginId}": downloaded file hash does not match manifest`
    );
  }
}

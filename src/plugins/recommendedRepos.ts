import type { FetchLike } from './types';

export interface RecommendedRepo {
  name: string;
  url: string;
  description: string;
  badge: string;
  verified: boolean;
}

export const RECOMMENDED_REPOS: RecommendedRepo[] = [
  {
    name: 'LNReader Official Plugins',
    url: 'https://raw.githubusercontent.com/LNReader/lnreader-plugins/plugins/v3.0.0/.dist/plugins.min.json',
    description: '370+ curated sources (Royal Road, Scribble Hub, WTR-LAB, Ranobes, LightNovelWorld & more).',
    badge: 'Official · Verified',
    verified: true,
  },
  {
    name: 'Nekori Community Plugins',
    url: 'https://raw.githubusercontent.com/Yuneko-dev/Nekori-plugins/plugins/v3.0.0/.dist/plugins.min.json',
    description: 'Community-maintained LNReader v3-compatible fork with extra and updated webnovel sources.',
    badge: 'Unverified · Community',
    verified: false,
  },
  {
    name: 'Tausif LNReader Plugins',
    url: 'https://raw.githubusercontent.com/Tausif-Husain/LNreader-Plugins/plugins/v3.0.0/.dist/plugins.min.json',
    description: 'Community fork hosting LNReader v3.0.0 plugin bundles.',
    badge: 'Unverified · Community Fork',
    verified: false,
  },
];

const VERIFIED_REPO_URLS = new Set(
  RECOMMENDED_REPOS.filter((r) => r.verified).map((r) => r.url.trim())
);

export function isVerifiedRepoUrl(url: string): boolean {
  return VERIFIED_REPO_URLS.has(url.trim());
}

const CANDIDATE_MANIFEST_PATHS = [
  'plugins/v3.0.0/.dist/plugins.min.json',
  'plugins/v3.0.0/plugins.min.json',
  'main/.dist/plugins.min.json',
];

function defaultFetch(): FetchLike {
  return (url, init) => fetch(url, init) as unknown as ReturnType<FetchLike>;
}

/**
 * Searches GitHub repositories and probes each match for a valid LNReader `plugins.min.json` manifest.
 */
export async function discoverGitHubPluginRepos(
  query: string,
  fetchImpl: FetchLike = defaultFetch()
): Promise<RecommendedRepo[]> {
  const q = query.trim() || 'lnreader-plugins';
  const searchUrl = `https://api.github.com/search/repositories?q=${encodeURIComponent(
    `${q} lnreader plugins`
  )}&sort=stars&per_page=8`;

  const res = await fetchImpl(searchUrl, {
    method: 'GET',
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) {
    throw new Error(`GitHub search failed (HTTP ${res.status})`);
  }

  const json = JSON.parse(await res.text()) as {
    items?: Array<{ full_name?: string; stargazers_count?: number; description?: string | null }>;
  };
  const items = Array.isArray(json.items) ? json.items : [];

  const verified: RecommendedRepo[] = [];
  for (const item of items) {
    if (!item.full_name) continue;
    for (const rel of CANDIDATE_MANIFEST_PATHS) {
      const candidateUrl = `https://raw.githubusercontent.com/${item.full_name}/${rel}`;
      try {
        const probe = await fetchImpl(candidateUrl, { method: 'HEAD' });
        if (probe.ok) {
          verified.push({
            name: item.full_name,
            url: candidateUrl,
            description: item.description?.trim() || 'Unverified GitHub repository — review before trusting',
            badge: `Unverified · ★ ${item.stargazers_count ?? 0}`,
            verified: false,
          });
          break;
        }
      } catch {
        // Ignore probe failures for individual repos
      }
    }
  }
  return verified;
}

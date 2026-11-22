import type { ReadingStatus } from '@/db/types';
import type { TrackerRemoteUpdate, TrackerSearchItem } from './types';

const ANILIST_API = 'https://graphql.anilist.co';

const STATUS_TO_ANILIST: Record<ReadingStatus, string> = {
  reading: 'CURRENT',
  plan_to_read: 'PLANNING',
  on_hold: 'PAUSED',
  completed: 'COMPLETED',
  dropped: 'DROPPED',
};

export function buildAniListImplicitAuthUrl(clientId: string): string {
  return `https://anilist.co/api/v2/oauth/authorize?client_id=${encodeURIComponent(clientId)}&response_type=token`;
}

export function extractAniListTokenFromRedirect(redirectUrl: string): string | null {
  const hash = redirectUrl.split('#')[1] ?? '';
  const params = new URLSearchParams(hash);
  return params.get('access_token');
}

export async function searchAniListNovels(query: string, accessToken?: string | null): Promise<TrackerSearchItem[]> {
  const gql = `
    query ($search: String) {
      Page(page: 1, perPage: 12) {
        media(search: $search, type: MANGA, format: NOVEL) {
          id
          title { romaji english }
          coverImage { medium }
          siteUrl
          chapters
          volumes
        }
      }
    }
  `;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const res = await fetch(ANILIST_API, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query: gql, variables: { search: query } }),
  });
  if (!res.ok) throw new Error(`AniList search failed (HTTP ${res.status})`);
  const json = (await res.json()) as {
    data?: {
      Page?: {
        media?: Array<{
          id: number;
          title?: { romaji?: string; english?: string };
          coverImage?: { medium?: string };
          siteUrl?: string;
          chapters?: number | null;
          volumes?: number | null;
        }>;
      };
    };
  };

  return (json.data?.Page?.media ?? []).map((m) => ({
    provider: 'anilist',
    remoteId: String(m.id),
    title: m.title?.english || m.title?.romaji || `AniList #${m.id}`,
    coverUrl: m.coverImage?.medium,
    url: m.siteUrl,
    totalChapters: m.chapters ?? null,
    totalVolumes: m.volumes ?? null,
  }));
}

export async function pushAniListProgress(accessToken: string, update: TrackerRemoteUpdate): Promise<void> {
  const mutation = `
    mutation ($mediaId: Int, $status: MediaListStatus, $progress: Int, $progressVolumes: Int, $score: Float) {
      SaveMediaListEntry(
        mediaId: $mediaId,
        status: $status,
        progress: $progress,
        progressVolumes: $progressVolumes,
        score: $score
      ) {
        id
        progress
      }
    }
  `;
  const res = await fetch(ANILIST_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      query: mutation,
      variables: {
        mediaId: Number.parseInt(update.remoteId, 10),
        status: STATUS_TO_ANILIST[update.status],
        progress: Math.max(0, Math.floor(update.chapter)),
        progressVolumes: Math.max(0, Math.floor(update.volume ?? 0)),
        score: update.score ?? 0,
      },
    }),
  });
  if (!res.ok) throw new Error(`AniList sync failed (HTTP ${res.status})`);
}

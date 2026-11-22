import type { ReadingStatus } from '@/db/types';
import type { TrackerRemoteUpdate, TrackerSearchItem } from './types';

const MAL_API = 'https://api.myanimelist.net/v2';

const STATUS_TO_MAL: Record<ReadingStatus, string> = {
  reading: 'reading',
  plan_to_read: 'plan_to_read',
  on_hold: 'on_hold',
  completed: 'completed',
  dropped: 'dropped',
};

export function buildMalPkceAuthUrl(
  clientId: string,
  codeChallenge: string,
  redirectUri: string,
  state?: string
): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    code_challenge: codeChallenge,
    code_challenge_method: 'plain',
    redirect_uri: redirectUri,
  });
  if (state) params.set('state', state);
  return `https://myanimelist.net/v1/oauth2/authorize?${params.toString()}`;
}

export async function exchangeMalCodeForToken(opts: {
  clientId: string;
  code: string;
  codeVerifier: string;
  redirectUri: string;
}): Promise<{ accessToken: string; refreshToken?: string }> {
  const body = new URLSearchParams({
    client_id: opts.clientId,
    grant_type: 'authorization_code',
    code: opts.code,
    code_verifier: opts.codeVerifier,
    redirect_uri: opts.redirectUri,
  });
  const res = await fetch('https://myanimelist.net/v1/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`MAL token exchange failed (HTTP ${res.status})`);
  const json = (await res.json()) as { access_token: string; refresh_token?: string };
  return { accessToken: json.access_token, refreshToken: json.refresh_token };
}

export async function searchMalNovels(query: string, accessToken: string): Promise<TrackerSearchItem[]> {
  const url = `${MAL_API}/manga?q=${encodeURIComponent(query)}&limit=12&fields=media_type,num_chapters,num_volumes,main_picture`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`MAL search failed (HTTP ${res.status})`);
  const json = (await res.json()) as {
    data?: Array<{
      node: {
        id: number;
        title: string;
        media_type?: string;
        num_chapters?: number;
        num_volumes?: number;
        main_picture?: { medium?: string };
      };
    }>;
  };
  return (json.data ?? [])
    .filter((entry) => !entry.node.media_type || entry.node.media_type.includes('novel'))
    .map((entry) => ({
      provider: 'mal',
      remoteId: String(entry.node.id),
      title: entry.node.title,
      coverUrl: entry.node.main_picture?.medium,
      url: `https://myanimelist.net/manga/${entry.node.id}`,
      totalChapters: entry.node.num_chapters ?? null,
      totalVolumes: entry.node.num_volumes ?? null,
    }));
}

export async function fetchMalProgress(
  remoteId: string,
  accessToken: string
): Promise<{ chapter: number; volume: number; score: number } | null> {
  const res = await fetch(`${MAL_API}/manga/${encodeURIComponent(remoteId)}?fields=my_list_status`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const json = (await res.json()) as {
    my_list_status?: { num_chapters_read?: number; num_volumes_read?: number; score?: number };
  };
  if (!json.my_list_status) return null;
  return {
    chapter: json.my_list_status.num_chapters_read ?? 0,
    volume: json.my_list_status.num_volumes_read ?? 0,
    score: json.my_list_status.score ?? 0,
  };
}

export async function pushMalProgress(accessToken: string, update: TrackerRemoteUpdate): Promise<void> {
  const body = new URLSearchParams({
    status: STATUS_TO_MAL[update.status],
    num_chapters_read: String(Math.max(0, Math.floor(update.chapter))),
    num_volumes_read: String(Math.max(0, Math.floor(update.volume ?? 0))),
  });
  if (update.score && update.score > 0) {
    body.set('score', String(Math.round(update.score)));
  }

  const res = await fetch(`${MAL_API}/manga/${encodeURIComponent(update.remoteId)}/my_list_status`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`MAL sync failed (HTTP ${res.status})`);
}

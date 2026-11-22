import type { ReadingStatus, TrackerProvider } from '@/db/types';

export interface TrackerSearchItem {
  provider: TrackerProvider;
  remoteId: string;
  title: string;
  coverUrl?: string;
  url?: string;
  totalChapters?: number | null;
  totalVolumes?: number | null;
}

export interface TrackerRemoteUpdate {
  remoteId: string;
  chapter: number;
  volume?: number;
  status: ReadingStatus;
  score?: number;
}

export interface TrackerAuthConfig {
  provider: 'anilist' | 'mal';
  clientId: string;
  accessToken: string | null;
}

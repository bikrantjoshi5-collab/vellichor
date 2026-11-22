import * as cheerio from 'cheerio';
import * as htmlparser2 from 'htmlparser2';
import dayjs from 'dayjs';
import { PluginHttpError, type FetchLike, type PluginKeyValueStorage } from './types';

export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36';

export const NovelStatus = {
  Unknown: 'Unknown',
  Ongoing: 'Ongoing',
  Completed: 'Completed',
  Licensed: 'Licensed',
  PublishingFinished: 'Publishing Finished',
  Cancelled: 'Cancelled',
  OnHiatus: 'On Hiatus',
} as const;

export const FilterTypes = {
  TextInput: 'Text',
  Picker: 'Picker',
  CheckboxGroup: 'Checkbox',
  Switch: 'Switch',
  ExcludableCheckboxGroup: 'XCheckbox',
} as const;

function looksLikeCloudflareChallenge(status: number, body?: string): boolean {
  if (status === 403 || status === 503) {
    if (!body) return status === 403;
    const lower = body.toLowerCase();
    return (
      lower.includes('just a moment') ||
      lower.includes('cf-browser-verification') ||
      lower.includes('cloudflare') ||
      lower.includes('challenge-platform')
    );
  }
  return false;
}

export function createPluginShims(opts: {
  fetchImpl?: FetchLike;
  storage: PluginKeyValueStorage;
  userAgent?: string;
}): Record<string, unknown> {
  const rawFetch: FetchLike =
    opts.fetchImpl ?? ((url, init) => fetch(url, init) as unknown as ReturnType<FetchLike>);
  const userAgent = opts.userAgent ?? DEFAULT_USER_AGENT;

  const fetchApi = async (
    url: string,
    init?: { method?: string; headers?: Record<string, string>; body?: string }
  ) => {
    const mergedHeaders: Record<string, string> = {
      'User-Agent': userAgent,
      ...(init?.headers ?? {}),
    };
    const res = await rawFetch(url, { ...init, headers: mergedHeaders });
    if (!res.ok) {
      if (res.status === 429) {
        throw new PluginHttpError(`Rate limited (HTTP 429) on ${url}`, 429, false);
      }
      if (res.status === 403 || res.status === 503) {
        const snippet = await res.text().catch(() => '');
        if (looksLikeCloudflareChallenge(res.status, snippet)) {
          throw new PluginHttpError(`Cloudflare verification required on ${url}`, res.status, true);
        }
        throw new PluginHttpError(`HTTP ${res.status} on ${url}`, res.status, false);
      }
      throw new PluginHttpError(`HTTP ${res.status} on ${url}`, res.status, false);
    }
    return res;
  };

  const fetchText = async (
    url: string,
    init?: { method?: string; headers?: Record<string, string>; body?: string }
  ) => {
    const res = await fetchApi(url, init);
    return res.text();
  };

  const isUrlAbsolute = (url: string) => /^https?:\/\//i.test(url);

  const storageShim = {
    storage: opts.storage,
    localStorage: opts.storage,
    sessionStorage: opts.storage,
  };

  const urlencodeShim = (str: string) => encodeURIComponent(str);
  (urlencodeShim as unknown as Record<string, unknown>).encode = (str: string) => encodeURIComponent(str);
  (urlencodeShim as unknown as Record<string, unknown>).decode = (str: string) => decodeURIComponent(str);

  return {
    cheerio,
    htmlparser2,
    dayjs,
    urlencode: urlencodeShim,
    '@libs/fetch': {
      fetchApi,
      fetchText,
      fetchFile: fetchText,
      fetchProto: fetchApi,
    },
    '@libs/storage': storageShim,
    '@libs/novelStatus': { NovelStatus },
    '@libs/filterInputs': { FilterTypes },
    '@libs/isAbsoluteUrl': { isUrlAbsolute },
    '@libs/defaultCover': { defaultCover: '' },
    '@libs/pluginBase': { PluginBase: class PluginBase {} },
  };
}

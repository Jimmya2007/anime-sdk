/**
 * AnimePaheProvider — Scraper for animepahe.pw
 *
 * AnimePahe uses DDoS-Guard protection, which requires FlareSolverr to bypass.
 * Provide a FlareSolverrClient instance in the options to enable this provider.
 *
 * Episode streams are served via Kwik (kwik.cx), which obfuscates JavaScript
 * to protect direct download URLs. We replicate the decode algorithm here.
 *
 * Sub/Dub detection: AnimePahe tags each episode with `audio: "jpn"` (sub)
 * or `audio: "eng"` (dub) in the release API response.
 */

import { BaseProvider } from './BaseProvider.js';
import { HttpClient } from '../transport/http.js';
import { FlareSolverrClient } from '../transport/flaresolverr.js';
import {
  IMediaSearchResult,
  IContentUnit,
  ResolvedMediaStream,
  MediaCatalogType,
  IVideoPayload,
  ContentLanguage,
} from '../types/index.js';

export interface AnimePaheOptions {
  baseUrl?: string;
  /**
   * FlareSolverr client instance. Required — AnimePahe uses DDoS-Guard protection.
   * Run FlareSolverr via Docker: ghcr.io/flaresolverr/flaresolverr:latest
   */
  flaresolverr: FlareSolverrClient;
  /** Default language preference. Defaults to 'sub'. */
  defaultLanguage?: ContentLanguage;
}

// ─── Kwik Decryption ─────────────────────────────────────────────────────────

const CHARACTER_MAP = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ+/';

function kwikGetString(content: string, s1: number, s2: number): string {
  const slice2 = CHARACTER_MAP.slice(0, s2);
  let acc = 0;
  const reversed = content.split('').reverse();
  for (let n = 0; n < reversed.length; n++) {
    const c = reversed[n];
    const digit = c.match(/\d/) ? parseInt(c, 10) : 0;
    acc += digit * Math.pow(s1, n);
  }
  let k = '';
  while (acc > 0) {
    const idx = Math.floor(acc % s2);
    k = slice2[idx] + k;
    acc = Math.floor((acc - (acc % s2)) / s2);
  }
  return k || '0';
}

function kwikDecrypt(fullString: string, key: string, v1: number, v2: number): string {
  let result = '';
  let i = 0;
  while (i < fullString.length) {
    let s = '';
    while (fullString[i] !== key[v2]) {
      s += fullString[i];
      i++;
    }
    let j = 0;
    while (j < key.length) {
      s = s.split(key[j]).join(String(j));
      j++;
    }
    result += String.fromCharCode(parseInt(kwikGetString(s, v2, 10), 10) - v1);
    i++;
  }
  return result;
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export class AnimePaheProvider extends BaseProvider {
  public readonly id = 'animepahe';
  public readonly supportedTypes: MediaCatalogType[] = ['ANIME'];

  private readonly baseUrl: string;
  private readonly flare: FlareSolverrClient;
  private readonly defaultLanguage: ContentLanguage;

  // Cookies collected from FlareSolverr to reuse in subsequent requests
  private sessionCookies: Array<{ name: string; value: string; domain?: string }> = [];

  constructor(http: HttpClient, options: AnimePaheOptions) {
    super(http);
    this.baseUrl = (options.baseUrl ?? 'https://animepahe.pw').replace(/\/$/, '');
    this.flare = options.flaresolverr;
    this.defaultLanguage = options.defaultLanguage ?? 'sub';
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Make a request through FlareSolverr with the saved cookies.
   */
  private async flareGet(url: string): Promise<{ status: number; text: string; json: any }> {
    const res = await this.flare.get(url, {
      cookies: this.sessionCookies.length > 0 ? this.sessionCookies : undefined,
    });
    return {
      status: res.status,
      text: res.text(),
      json: () => {
        try { return res.json(); } catch { return null; }
      },
    };
  }

  /**
   * Ensure we have DDoS-Guard cookies by hitting the homepage first.
   * This primes FlareSolverr's session.
   */
  private async ensureSession(): Promise<void> {
    if (this.sessionCookies.length > 0) return;
    // Hitting the home page will get FlareSolverr to solve the challenge
    await this.flare.get(this.baseUrl);
    // Subsequent calls will reuse the FlareSolverr browser session
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  /**
   * Search for anime. Requires FlareSolverr to bypass DDoS-Guard.
   */
  public async search(query: string): Promise<IMediaSearchResult[]> {
    await this.ensureSession();

    const url = `${this.baseUrl}/api?m=search&q=${encodeURIComponent(query)}`;
    const res = await this.flareGet(url);

    if (res.status !== 200) {
      throw new Error(`AnimePahe search failed with status ${res.status}`);
    }

    const json = res.json();
    const data: any[] = json?.data ?? [];
    const results: IMediaSearchResult[] = [];

    for (const item of data) {
      const id = item.session ?? item.id ?? String(item.id);
      const title = item.title ?? '';
      if (!title || !id) continue;

      results.push({
        id,
        title,
        thumbnailUrl: item.poster,
        catalogType: 'ANIME',
        providerId: this.id,
        // AnimePahe search doesn't readily expose sub/dub availability in this endpoint
        // Users can call fetchContentUnits and check episode language fields
        availableLanguages: ['sub', 'dub'],
      });
    }

    return results;
  }

  /**
   * Fetch episodes for a given anime session (UUID format from search results).
   * @param mediaId - Anime session UUID from search
   * @param language - Language filter. Returns all episodes but marks their language.
   */
  public async fetchContentUnits(mediaId: string, language?: ContentLanguage): Promise<IContentUnit[]> {
    await this.ensureSession();

    const preferredLang = language ?? this.defaultLanguage;
    const units: IContentUnit[] = [];

    let page = 1;
    let totalPages = 1;

    do {
      const url = `${this.baseUrl}/api?m=release&id=${mediaId}&sort=episode_asc&page=${page}`;
      const res = await this.flareGet(url);

      if (res.status !== 200) {
        throw new Error(`AnimePahe episodes fetch failed with status ${res.status}`);
      }

      const json = res.json();
      if (!json) throw new Error('AnimePahe returned invalid JSON for episode list');

      const perPage: number = json.per_page ?? 30;
      const total: number = json.total ?? 0;
      totalPages = Math.ceil(total / perPage);

      const episodes: any[] = json.data ?? [];

      for (const ep of episodes) {
        // audio: "jpn" = sub, "eng" = dub
        const audio = (ep.audio ?? 'jpn').toLowerCase();
        const epLang: ContentLanguage = audio === 'eng' ? 'dub' : 'sub';

        // If a language filter is set, skip episodes of the other type
        if (preferredLang !== 'raw' && epLang !== preferredLang) continue;

        const epNum = parseFloat(String(ep.episode ?? ep.episode2 ?? 0));
        const session: string = ep.session ?? '';
        if (!session) continue;

        units.push({
          // ID format: {animeSession}/{episodeSession}/{language}
          id: `${mediaId}/${session}/${epLang}`,
          title: ep.title ? `Episode ${ep.episode}: ${ep.title}` : `Episode ${ep.episode}`,
          number: epNum,
          language: epLang,
        });
      }

      page++;
    } while (page <= totalPages);

    return units.sort((a, b) => a.number - b.number);
  }

  /**
   * Resolve a stream URL for an episode.
   * Decrypts the Kwik obfuscated JavaScript to extract the HLS stream.
   * @param unitId - format: {animeSession}/{episodeSession}/{language}
   */
  public async resolveStream(unitId: string, language?: ContentLanguage): Promise<ResolvedMediaStream> {
    await this.ensureSession();

    const parts = unitId.split('/');
    if (parts.length < 2) {
      throw new Error(`Invalid AnimePahe unit ID: ${unitId}`);
    }
    const animeSession = parts[0];
    const episodeSession = parts[1];
    const unitLang = parts[2] as ContentLanguage | undefined;
    const lang = language ?? unitLang ?? this.defaultLanguage;

    // Step 1: Load the play page for this episode to get server dropdown links
    const playUrl = `${this.baseUrl}/play/${animeSession}/${episodeSession}`;
    const playRes = await this.flareGet(playUrl);

    if (playRes.status !== 200) {
      throw new Error(`AnimePahe: Failed to load play page for ${episodeSession}`);
    }

    // Step 2: Extract Kwik embed URLs from dropdown links
    // Matches: <a href="https://kwik.si/e/..." ...> or pahe.win redirect links
    const kwikLinkRegex = /href="(https?:\/\/(?:kwik\.[a-z]+|pahe\.win)\/(?:e|f|d)\/[^"]+)"/gi;
    let match: RegExpExecArray | null;
    const kwikUrls: string[] = [];

    while ((match = kwikLinkRegex.exec(playRes.text)) !== null) {
      kwikUrls.push(match[1]);
    }

    // Also look for data-src with kwik
    const dataSrcRegex = /data-(?:src|video)="(https?:\/\/kwik\.[a-z]+\/(?:e|f)\/[^"]+)"/gi;
    while ((match = dataSrcRegex.exec(playRes.text)) !== null) {
      kwikUrls.push(match[1]);
    }

    if (kwikUrls.length === 0) {
      throw new Error(`AnimePahe: No Kwik embed URLs found on play page for ${episodeSession}`);
    }

    // Step 3: Resolve each Kwik URL to a stream
    const streams: IVideoPayload[] = [];

    for (const kwikUrl of kwikUrls) {
      try {
        const streamUrl = await this.resolveKwikUrl(kwikUrl);
        if (streamUrl) {
          streams.push({
            sourceUrl: streamUrl,
            isHLS: streamUrl.includes('.m3u8'),
            quality: 'auto',
            language: lang,
            headers: {
              Referer: 'https://kwik.si/',
            },
          });
        }
      } catch (err) {
        // Try remaining URLs if one fails
      }
    }

    if (streams.length === 0) {
      throw new Error(`AnimePahe: Failed to resolve any stream URLs for ${unitId}`);
    }

    return { type: 'video', streams };
  }

  // ─── Kwik Resolution ──────────────────────────────────────────────────────

  /**
   * Resolve a Kwik embed URL to a direct stream URL.
   * Kwik uses obfuscated JavaScript with a custom encoding scheme.
   *
   * The algorithm:
   * 1. Load the Kwik embed page (via FlareSolverr due to Cloudflare)
   * 2. Match the packed JS: ("fullKey",digits,"key",v1,v2,...)
   * 3. Decrypt using the base-conversion + substitution cipher
   * 4. Extract the action URL and _token from the decrypted HTML form
   * 5. POST to the action URL with _token (Referer: kwik.si)
   * 6. Follow the 302 redirect to get the final .m3u8 URL
   */
  private async resolveKwikUrl(kwikUrl: string): Promise<string | null> {
    // Normalize to /e/ embed page if it's already on /f/ or /d/
    const embedUrl = kwikUrl.replace(/\/[fd]\//, '/e/');

    // Load through FlareSolverr (Kwik is on Cloudflare)
    const embedRes = await this.flare.get(embedUrl);
    const embedHtml = embedRes.text();

    // Extract the packed JS parameters
    // Pattern: ("fullKey",digits,"key",v1,v2,...)
    const paramsMatch = embedHtml.match(/\("(\w+)",\d+,"(\w+)",(\d+),(\d+),\d+\)/);
    if (!paramsMatch) {
      // Maybe it's a direct source without obfuscation
      const directM3u8 = embedHtml.match(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/);
      if (directM3u8) return directM3u8[0];
      return null;
    }

    const [, fullKey, key, v1Str, v2Str] = paramsMatch;
    const v1 = parseInt(v1Str, 10);
    const v2 = parseInt(v2Str, 10);

    // Decrypt the obfuscated JS
    const decryptedJs = kwikDecrypt(fullKey, key, v1, v2);

    // Extract form action URL and _token from decrypted JS
    const actionMatch = decryptedJs.match(/action="([^"]+)"/);
    const tokenMatch = decryptedJs.match(/value="([^"]+)"/);

    if (!actionMatch || !tokenMatch) {
      // Try to find m3u8 in decrypted content
      const m3u8 = decryptedJs.match(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/);
      if (m3u8) return m3u8[0];
      return null;
    }

    const actionUrl = actionMatch[1];
    const token = tokenMatch[1];

    // POST to the action URL — Kwik requires Referer to be from kwik domain
    // We use FlareSolverr here since Kwik is Cloudflare-protected
    const postRes = await this.flare.post(
      actionUrl,
      { _token: token },
      {
        headers: {
          Referer: 'https://kwik.si/',
        },
      }
    );

    // The response URL after FlareSolverr follows the redirect is the final URL
    if (postRes.url && (postRes.url.includes('.m3u8') || postRes.url.includes('.mp4'))) {
      return postRes.url;
    }

    // Search in the response body for the stream URL
    const bodyText = postRes.text();
    const m3u8Match = bodyText.match(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/);
    if (m3u8Match) return m3u8Match[0];

    const mp4Match = bodyText.match(/https?:\/\/[^"'\s]+\.mp4[^"'\s]*/);
    if (mp4Match) return mp4Match[0];

    return null;
  }
}

import { BaseProvider } from './BaseProvider.js';
import { HttpClient } from '../transport/http.js';
import { aesDecryptCtr } from '../utils/crypto.js';
import {
  IMediaSearchResult,
  IContentUnit,
  ResolvedMediaStream,
  MediaCatalogType,
  IVideoPayload,
  ContentLanguage,
} from '../types/index.js';

export interface AllmangaOptions {
  baseUrl?: string;
  /** Default language to use if not specified per-call. Defaults to 'sub'. */
  defaultLanguage?: ContentLanguage;
}

const hexSubstitutionTable: Record<string, string> = {
  "79": "A", "7a": "B", "7b": "C", "7c": "D", "7d": "E", "7e": "F", "7f": "G",
  "70": "H", "71": "I", "72": "J", "73": "K", "74": "L", "75": "M", "76": "N", "77": "O",
  "68": "P", "69": "Q", "6a": "R", "6b": "S", "6c": "T", "6d": "U", "6e": "V", "6f": "W",
  "60": "X", "61": "Y", "62": "Z",
  "59": "a", "5a": "b", "5b": "c", "5c": "d", "5d": "e", "5e": "f", "5f": "g",
  "50": "h", "51": "i", "52": "j", "53": "k", "54": "l", "55": "m", "56": "n", "57": "o",
  "48": "p", "49": "q", "4a": "r", "4b": "s", "4c": "t", "4d": "u", "4e": "v", "4f": "w",
  "40": "x", "41": "y", "42": "z",
  "08": "0", "09": "1", "0a": "2", "0b": "3", "0c": "4", "0d": "5", "0e": "6", "0f": "7",
  "00": "8", "01": "9",
  "15": "-", "16": ".", "67": "_", "46": "~",
  "02": ":", "17": "/", "07": "?", "1b": "#",
  "63": "[", "65": "]", "78": "@",
  "19": "!", "1c": "$", "1e": "&",
  "10": "(", "11": ")", "12": "*", "13": "+", "14": ",",
  "03": ";", "05": "=", "1d": "%"
};

function decodeSourceURL(encoded: string): string {
  let result = '';
  for (let i = 0; i < encoded.length; i += 2) {
    const pair = encoded.substring(i, i + 2);
    if (hexSubstitutionTable[pair] !== undefined) {
      result += hexSubstitutionTable[pair];
    } else {
      result += pair;
    }
  }
  result = result.replace(/\/clock/g, '/clock.json');
  if (result.startsWith('/')) {
    result = 'https://allanime.day' + result;
  }
  return result;
}

export class AllmangaProvider extends BaseProvider {
  public readonly id = 'allmanga';
  public readonly supportedTypes: MediaCatalogType[] = ['ANIME'];
  private apiBase = 'https://api.allanime.day/api';
  private referer = 'https://allmanga.to';
  private origin = 'https://youtu-chan.com';
  private userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0';
  private defaultLanguage: ContentLanguage;

  constructor(http: HttpClient, options: AllmangaOptions = {}) {
    super(http);
    if (options.baseUrl) {
      this.apiBase = options.baseUrl;
    }
    this.defaultLanguage = options.defaultLanguage ?? 'sub';
  }

  /**
   * Search for anime using AllManga's GraphQL API.
   */
  public async search(query: string): Promise<IMediaSearchResult[]> {
    const searchGql = `query($search: SearchInput, $limit: Int, $page: Int, $countryOrigin: VaildCountryOriginEnumType) {
      shows(search: $search, limit: $limit, page: $page, countryOrigin: $countryOrigin) {
        edges {
          _id
          name
          englishName
          availableEpisodes
          __typename
        }
      }
    }`;

    const variables = {
      search: {
        allowAdult: false,
        allowUnknown: false,
        query: query
      },
      limit: 40,
      page: 1,
      countryOrigin: "ALL"
    };

    const response = await this.http.post(
      this.apiBase,
      {
        variables,
        query: searchGql
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Referer': this.referer,
          'User-Agent': this.userAgent
        }
      }
    );

    if (response.status !== 200) {
      throw new Error(`AllManga search failed with status ${response.status}`);
    }

    const json = await response.json() as any;
    const edges = json?.data?.shows?.edges || [];
    const results: IMediaSearchResult[] = [];

    for (const edge of edges) {
      const title = edge.englishName || edge.name;
      if (!title) continue;

      // Determine which translation types are available
      const avail = edge.availableEpisodes as Record<string, number> | undefined;
      const availableLanguages: ContentLanguage[] = [];
      if (avail?.sub) availableLanguages.push('sub');
      if (avail?.dub) availableLanguages.push('dub');
      if (avail?.raw) availableLanguages.push('raw');

      results.push({
        id: edge._id,
        title,
        catalogType: 'ANIME',
        providerId: this.id,
        availableLanguages: availableLanguages.length > 0 ? availableLanguages : undefined,
      });
    }

    return results;
  }

  /**
   * Fetch episode list for a show ID.
   */
  public async fetchContentUnits(mediaId: string, language?: ContentLanguage): Promise<IContentUnit[]> {
    const lang = language ?? this.defaultLanguage;
    const episodesListGql = `query ($showId: String!) { show( _id: $showId ) { _id availableEpisodesDetail }}`;

    const response = await this.http.post(
      this.apiBase,
      {
        variables: { showId: mediaId },
        query: episodesListGql
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Referer': this.referer,
          'User-Agent': this.userAgent
        }
      }
    );

    if (response.status !== 200) {
      throw new Error(`Failed to fetch AllManga episodes: ${response.status}`);
    }

    const json = await response.json() as any;
    const detail = json?.data?.show?.availableEpisodesDetail || {};

    // Use requested language track, fall back to sub if no episodes in that track
    const episodes: string[] = detail[lang] || detail.sub || [];
    const resolvedLang: ContentLanguage = detail[lang]?.length > 0 ? lang : 'sub';

    const units: IContentUnit[] = [];
    for (const epStr of episodes) {
      const num = parseFloat(epStr);
      if (isNaN(num)) continue;

      units.push({
        id: `${mediaId}/${epStr}/${resolvedLang}`,
        title: `Episode ${epStr}`,
        number: num,
        language: resolvedLang,
      });
    }

    return units.sort((a, b) => a.number - b.number);
  }

  /**
   * Decrypt "tobeparsed" blob.
   */
  private async decryptTobeparsed(blob: string): Promise<any[]> {
    let binaryString: string;
    try {
      binaryString = atob(blob);
    } catch (e) {
      const normalized = blob.replace(/-/g, '+').replace(/_/g, '/');
      const pad = normalized.length % 4;
      const padded = pad ? normalized + '='.repeat(4 - pad) : normalized;
      binaryString = atob(padded);
    }

    const data = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      data[i] = binaryString.charCodeAt(i);
    }

    if (data.length < 30) {
      throw new Error(`tobeparsed blob too short (${data.length} bytes)`);
    }

    const nonce = data.subarray(1, 13);
    const ciphertext = data.subarray(13, data.length - 16);

    const keyPhraseBytes = new TextEncoder().encode("Xot36i3lK3:v1");
    // Web Cryptography subtle digest
    const subtle = globalThis.crypto.subtle;
    const keyHash = await subtle.digest('SHA-256', keyPhraseBytes);
    const key = new Uint8Array(keyHash);

    const iv = new Uint8Array(16);
    iv.set(nonce, 0);
    const view = new DataView(iv.buffer);
    view.setUint32(12, 2, false); // big-endian counter starting at 2

    const decryptedBytes = await aesDecryptCtr(ciphertext, key, iv);
    const decryptedStr = new TextDecoder().decode(decryptedBytes);

    const parsed = JSON.parse(decryptedStr);
    
    if (parsed.episode && Array.isArray(parsed.episode.sourceUrls)) {
      return parsed.episode.sourceUrls;
    }
    if (parsed.data && parsed.data.episode && Array.isArray(parsed.data.episode.sourceUrls)) {
      return parsed.data.episode.sourceUrls;
    }
    throw new Error("No source URLs found in decrypted tobeparsed data");
  }

  /**
   * Resolve streams for a unitId (format: showId/episodeString).
   */
  public async resolveStream(unitId: string, language?: ContentLanguage): Promise<ResolvedMediaStream> {
    const parts = unitId.split('/');
    if (parts.length < 2) {
      throw new Error(`Invalid AllManga unit ID: ${unitId}`);
    }
    const showId = parts[0];
    const episodeString = parts[1];
    // Unit ID encodes language as 3rd segment (set during fetchContentUnits)
    const unitLang = parts[2] as ContentLanguage | undefined;
    const lang = language ?? unitLang ?? this.defaultLanguage;

    const variables = {
      showId,
      translationType: lang,
      episodeString
    };

    const extensions = {
      persistedQuery: {
        version: 1,
        sha256Hash: "d405d0edd690624b66baba3068e0edc3ac90f1597d898a1ec8db4e5c43c00fec"
      }
    };

    const queryUrl = `${this.apiBase}?variables=${encodeURIComponent(JSON.stringify(variables))}&extensions=${encodeURIComponent(JSON.stringify(extensions))}`;

    const response = await this.http.get(queryUrl, {
      headers: {
        'Origin': this.origin,
        'Referer': this.referer,
        'User-Agent': this.userAgent
      }
    });

    if (response.status !== 200) {
      throw new Error(`Failed to load AllManga stream sources: ${response.status}`);
    }

    const json = await response.json() as any;
    const tobeparsed = json?.data?.tobeparsed;
    if (!tobeparsed) {
      throw new Error(`Missing tobeparsed encrypted payload from AllManga response`);
    }

    const sourceUrls = await this.decryptTobeparsed(tobeparsed);
    const videoSources: IVideoPayload[] = [];

    const clockPromises = sourceUrls.map(async (src) => {
      let rawUrl = src.sourceUrl || '';
      if (!rawUrl) return [];

      if (rawUrl.startsWith('--')) {
        rawUrl = decodeSourceURL(rawUrl.substring(2));
      }

      if (rawUrl.startsWith('//')) {
        rawUrl = 'https:' + rawUrl;
      }

      if (rawUrl.includes('/clock.json')) {
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 4000);
          
          const clockRes = await this.http.get(rawUrl, {
            headers: {
              'Referer': this.referer,
              'User-Agent': this.userAgent
            },
            signal: controller.signal as any
          });
          clearTimeout(timer);

          if (clockRes.status === 200) {
            const clockJson = await clockRes.json() as any;
            const links = clockJson.links || [];
            const localSources: IVideoPayload[] = [];
            for (const item of links) {
              const link = item.link || '';
              if (!link) continue;

              if (link.includes('repackager.wixmp.com')) {
                const wixmpMatch = link.match(/\/,(.*?),\/mp4/);
                if (wixmpMatch) {
                  const qualities = wixmpMatch[1].split(',');
                  const cleanBase = link.replace('repackager.wixmp.com/', '').replace(/\.urlset\/master\.m3u8$/, '');
                  for (const q of qualities) {
                    const streamUrl = cleanBase.replace(`/,${wixmpMatch[1]},/mp4/`, `/${q}/mp4/`);
                    let qualityLabel: '1080p' | '720p' | '360p' | 'auto' = 'auto';
                    if (q.includes('1080')) qualityLabel = '1080p';
                    else if (q.includes('720')) qualityLabel = '720p';
                    else if (q.includes('480') || q.includes('360')) qualityLabel = '360p';

                    localSources.push({
                      sourceUrl: streamUrl,
                      isHLS: false,
                      quality: qualityLabel,
                      headers: { Referer: this.referer }
                    });
                  }
                } else {
                  localSources.push({
                    sourceUrl: link,
                    isHLS: true,
                    quality: 'auto',
                    headers: { Referer: this.referer }
                  });
                }
              } else {
                localSources.push({
                  sourceUrl: link,
                  isHLS: item.hls || link.includes('.m3u8'),
                  quality: 'auto',
                  headers: { Referer: this.referer }
                });
              }
            }
            return localSources;
          }
        } catch (e) {
          // ignore clock request errors or timeouts
        }
        return [];
      } else {
        const payload: IVideoPayload = {
          sourceUrl: rawUrl,
          isHLS: rawUrl.includes('.m3u8'),
          quality: 'auto',
          headers: { Referer: this.referer }
        };
        return [payload];
      }
    });

    const results = await Promise.all(clockPromises);
    for (const r of results) {
      videoSources.push(...r);
    }

    if (videoSources.length === 0) {
      throw new Error(`Failed to extract any playback streams for AllManga episode: ${unitId}`);
    }

    // Sort sources so that direct wixstatic / MP4 / HLS streams are prioritized first
    videoSources.sort((a, b) => {
      const getScore = (url: string) => {
        if (url.includes('wixstatic.com')) return 100;
        if (url.includes('.m3u8')) return 90;
        if (url.includes('.mp4')) return 80;
        if (url.includes('sharepoint.com')) return 70;
        if (url.includes('ok.ru')) return 10;
        return 0;
      };
      return getScore(b.sourceUrl) - getScore(a.sourceUrl);
    });

    return {
      type: 'video',
      streams: videoSources
    };
  }
}

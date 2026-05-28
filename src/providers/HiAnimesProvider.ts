/**
 * HiAnimesProvider — Scraper for hianimes.se (HiAnime fork)
 *
 * HiAnimes.se is a continuation of the original HiAnime/Zoro.to platform using
 * the same codebase and AJAX API structure. It requires FlareSolverr to bypass
 * Cloudflare protection.
 *
 * API endpoints (aniwatch/zoro-compatible):
 * - Search:         GET /ajax/search?keyword={q}
 * - Episode list:   GET /ajax/v2/episode/list/{animeId}
 * - Server list:    GET /ajax/v2/episode/servers?episodeId={id}
 * - Stream source:  GET /ajax/v2/episode/sources?id={serverId}
 *
 * Sub/Dub: The server list endpoint groups servers by "sub" and "dub" categories.
 */

import { BaseProvider } from './BaseProvider.js';
import { HttpClient } from '../transport/http.js';
import { FlareSolverrClient } from '../transport/flaresolverr.js';
import { DomRegistry } from '../transport/dom.js';
import {
  IMediaSearchResult,
  IContentUnit,
  ResolvedMediaStream,
  MediaCatalogType,
  IVideoPayload,
  ContentLanguage,
} from '../types/index.js';

export interface HiAnimesOptions {
  baseUrl?: string;
  /**
   * FlareSolverr client instance. Required — HiAnimes uses Cloudflare protection.
   * Run FlareSolverr via Docker: ghcr.io/flaresolverr/flaresolverr:latest
   */
  flaresolverr: FlareSolverrClient;
  /** Default language preference. Defaults to 'sub'. */
  defaultLanguage?: ContentLanguage;
}

interface HiAnimesSearchItem {
  id: string;
  title: string;
  thumbnail?: string;
}

interface HiAnimesEpisode {
  id: number;     // episode server data-id
  number: number;
  title?: string;
}

export class HiAnimesProvider extends BaseProvider {
  public readonly id = 'hianimes';
  public readonly supportedTypes: MediaCatalogType[] = ['ANIME'];

  private readonly baseUrl: string;
  private readonly flare: FlareSolverrClient;
  private readonly defaultLanguage: ContentLanguage;

  constructor(http: HttpClient, options: HiAnimesOptions) {
    super(http);
    this.baseUrl = (options.baseUrl ?? 'https://hianimes.se').replace(/\/$/, '');
    this.flare = options.flaresolverr;
    this.defaultLanguage = options.defaultLanguage ?? 'sub';
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Make an AJAX GET request through FlareSolverr, expecting JSON response.
   */
  private async ajaxGet(path: string): Promise<any> {
    const url = `${this.baseUrl}${path}`;
    const res = await this.flare.get(url, {});
    const text = res.text();
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  /**
   * Search for anime. Requires FlareSolverr.
   */
  public async search(query: string): Promise<IMediaSearchResult[]> {
    // The /ajax/search endpoint returns JSON with rendered HTML in `html` key
    const json = await this.ajaxGet(`/ajax/search?keyword=${encodeURIComponent(query)}`);

    if (!json || typeof json.html !== 'string') {
      // Fallback: try scraping the search results page directly
      return this.searchViaPage(query);
    }

    const doc = DomRegistry.parse(json.html);
    return this.parseSearchResultsHtml(doc);
  }

  /**
   * Fallback: parse the search results page directly using FlareSolverr.
   */
  private async searchViaPage(query: string): Promise<IMediaSearchResult[]> {
    const url = `${this.baseUrl}/search?keyword=${encodeURIComponent(query)}`;
    const res = await this.flare.get(url);
    const html = res.text();
    const doc = DomRegistry.parse(html);
    return this.parseSearchResultsHtml(doc);
  }

  /**
   * Parse search result HTML cards (works for both AJAX and direct page HTML).
   */
  private parseSearchResultsHtml(doc: ReturnType<typeof DomRegistry.parse>): IMediaSearchResult[] {
    const results: IMediaSearchResult[] = [];

    // HiAnime search result cards: div.flw-item or similar
    const cards = doc.querySelectorAll(
      'div.flw-item, article.flw-item, div.film-detail, div.item-list'
    );

    for (const card of cards) {
      const linkEl = card.querySelector('a[href*="/watch/"], a[href*="/anime/"]');
      if (!linkEl) continue;

      const href = linkEl.getAttribute('href') || '';
      if (!href) continue;

      // Extract anime ID from URL: /watch/{anime-slug}-{id} → last numeric segment or full slug
      const idMatch = href.match(/\/watch\/([^?#]+)/) || href.match(/\/anime\/([^?#]+)/);
      if (!idMatch) continue;

      const mediaId = idMatch[1];
      const titleEl = card.querySelector('h3.film-name, h3, .film-name, a[title]');
      const title =
        (titleEl?.getAttribute('title') || titleEl?.textContent || linkEl.getAttribute('title') || '').trim();

      if (!title) continue;

      const imgEl = card.querySelector('img');
      const thumbnailUrl =
        imgEl?.getAttribute('data-src') || imgEl?.getAttribute('src') || undefined;

      // Check for sub/dub indicators
      const subCount = card.querySelector('.tick-sub, [class*="sub"]')?.textContent?.trim();
      const dubCount = card.querySelector('.tick-dub, [class*="dub"]')?.textContent?.trim();
      const availableLanguages: ContentLanguage[] = [];
      if (subCount && parseInt(subCount, 10) > 0) availableLanguages.push('sub');
      if (dubCount && parseInt(dubCount, 10) > 0) availableLanguages.push('dub');

      results.push({
        id: mediaId,
        title,
        thumbnailUrl,
        catalogType: 'ANIME',
        providerId: this.id,
        availableLanguages: availableLanguages.length > 0 ? availableLanguages : undefined,
      });
    }

    return results;
  }

  /**
   * Fetch episodes for a given anime slug/ID.
   * @param mediaId - Anime slug from search (e.g., "naruto-shippuden-355")
   * @param language - Language preference for labeling episodes.
   */
  public async fetchContentUnits(mediaId: string, language?: ContentLanguage): Promise<IContentUnit[]> {
    // Extract numeric ID if present, or use the full slug
    // HiAnime anime IDs look like: "naruto-shippuden-355" where 355 is the numeric ID
    const numericIdMatch = mediaId.match(/(\d+)$/);
    const animeId = numericIdMatch ? numericIdMatch[1] : mediaId;

    const lang = language ?? this.defaultLanguage;

    const json = await this.ajaxGet(`/ajax/v2/episode/list/${animeId}`);

    if (!json || typeof json.html !== 'string') {
      throw new Error(`HiAnimes: Failed to fetch episode list for ${mediaId}`);
    }

    const doc = DomRegistry.parse(json.html);
    const episodeLinks = doc.querySelectorAll('a[title][data-number], li.ep-item a, div.ep-item a');

    const units: IContentUnit[] = [];

    for (const link of episodeLinks) {
      const dataId = link.getAttribute('data-id') || link.getAttribute('id') || '';
      const dataNumber = link.getAttribute('data-number') || link.getAttribute('data-ep') || '';
      const href = link.getAttribute('href') || '';
      const title = (link.getAttribute('title') || link.textContent || '').trim();

      const num = parseFloat(dataNumber || '0');
      if (isNaN(num) || num === 0) continue;

      // ID format: {animeSlug}/{episodeDataId}/{language}
      const epId = dataId || href.split('ep=').pop() || String(num);

      units.push({
        id: `${mediaId}/${epId}/${lang}`,
        title: title || `Episode ${num}`,
        number: num,
        language: lang,
      });
    }

    return units.sort((a, b) => a.number - b.number);
  }

  /**
   * Resolve a stream URL for an episode.
   * @param unitId - format: {animeSlug}/{episodeDataId}/{language}
   */
  public async resolveStream(unitId: string, language?: ContentLanguage): Promise<ResolvedMediaStream> {
    const parts = unitId.split('/');
    if (parts.length < 2) {
      throw new Error(`Invalid HiAnimes unit ID: ${unitId}`);
    }

    const episodeDataId = parts[parts.length - 2];
    const unitLang = parts[parts.length - 1] as ContentLanguage | undefined;
    const lang = language ?? unitLang ?? this.defaultLanguage;

    // Step 1: Get available servers for this episode
    const serversJson = await this.ajaxGet(`/ajax/v2/episode/servers?episodeId=${episodeDataId}`);

    if (!serversJson || typeof serversJson.html !== 'string') {
      throw new Error(`HiAnimes: Failed to fetch servers for episode ${episodeDataId}`);
    }

    const serversDoc = DomRegistry.parse(serversJson.html);

    // Server items are divided by sub/dub type
    // Look for: div.ps_-block div[data-server-id] or li with data-type="sub/dub"
    const serverItems = serversDoc.querySelectorAll(
      `[data-type="${lang}"] li[data-id], ` +
      `div.servers-${lang} li[data-id], ` +
      `div[data-type="${lang}"] .nav-item[data-id]`
    );

    // Fallback: grab any server if language-specific ones aren't found
    const allServerItems = serversDoc.querySelectorAll('li[data-id], .item[data-id]');
    const targetItems = serverItems.length > 0 ? serverItems : allServerItems;

    const streams: IVideoPayload[] = [];

    for (const item of targetItems) {
      const serverId = item.getAttribute('data-id') || '';
      if (!serverId) continue;

      try {
        const sourcesJson = await this.ajaxGet(`/ajax/v2/episode/sources?id=${serverId}`);
        if (!sourcesJson) continue;

        // Extract stream URL from the sources response
        const streamUrl: string = sourcesJson.link || sourcesJson.url || sourcesJson.sources?.[0]?.file || '';
        if (!streamUrl) continue;

        streams.push({
          sourceUrl: streamUrl,
          isHLS: streamUrl.includes('.m3u8'),
          quality: 'auto',
          language: lang,
          headers: {
            Referer: this.baseUrl,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
          },
        });
      } catch (err) {
        // Try next server
      }
    }

    if (streams.length === 0) {
      throw new Error(`HiAnimes: Failed to resolve any stream for episode ${episodeDataId}`);
    }

    return { type: 'video', streams };
  }
}

import { BaseProvider } from './BaseProvider.js';
import { HttpClient } from '../transport/http.js';
import { DomRegistry } from '../transport/dom.js';
import { FlareSolverrClient } from '../transport/flaresolverr.js';
import {
  IMediaSearchResult,
  IContentUnit,
  ResolvedMediaStream,
  MediaCatalogType,
} from '../types/index.js';

export interface SuperFlixEpisode {
  epi_num: string | number;
  title: string;
  air_date: string;
}

export interface SuperFlixOptions {
  baseUrl?: string;
  flaresolverr?: FlareSolverrClient;
}

export class SuperFlixProvider extends BaseProvider {
  public readonly id = 'superflix';
  public readonly supportedTypes: MediaCatalogType[] = ['MOVIE', 'TV', 'ANIME'];
  private defaultBaseUrl: string = 'https://superflixapi.best';
  private readonly flare?: FlareSolverrClient;

  constructor(http: HttpClient, options: SuperFlixOptions = {}) {
    super(http);
    if (options.baseUrl) {
      this.defaultBaseUrl = options.baseUrl;
    }
    this.flare = options.flaresolverr;
    // Inject default user-agent if not already configured
    if (!this.http.getDefaultHeaders()['User-Agent']) {
      this.http.setUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      );
    }
  }

  private get baseUrl(): string {
    return this.defaultBaseUrl;
  }

  /**
   * Normalize cover image URLs to high-quality direct TMDB image paths.
   */
  private normalizeImage(urlText: string): string {
    if (!urlText) return '';
    const tmdbPrefix = 'https://image.tmdb.org/t/p/';
    const idx = urlText.indexOf(tmdbPrefix);
    if (idx >= 0) {
      let direct = urlText.substring(idx);
      direct = direct.replace('/w342/', '/w500/');
      direct = direct.replace('/w185/', '/w500/');
      direct = direct.replace('/w154/', '/w500/');
      return direct;
    }
    return urlText;
  }

  public async search(query: string): Promise<IMediaSearchResult[]> {
    let normalized = query.trim();
    normalized = normalized.replace(/[-_]/g, ' ');
    while (normalized.includes('  ')) {
      normalized = normalized.replace('  ', ' ');
    }

    const searchUrl = `${this.baseUrl}/pesquisar?s=${encodeURIComponent(normalized)}`;
    const response = await this.http.get(searchUrl);
    if (response.status !== 200) {
      throw new Error(`SuperFlix search failed with status ${response.status}`);
    }

    const html = await response.text();
    const doc = DomRegistry.parse(html);
    const divs = doc.querySelectorAll('div');

    const results: IMediaSearchResult[] = [];
    const seen = new Set<string>();

    for (const card of divs) {
      const cls = card.getAttribute('class') || '';
      if (!cls.split(/\s+/).includes('group/card')) {
        continue;
      }

      let title = '';
      let imageUrl = '';
      const img = card.querySelector('img');
      if (img) {
        title = img.getAttribute('alt') || '';
        const src = img.getAttribute('src') || '';
        const dataSrc = img.getAttribute('data-src') || '';
        const srcset = img.getAttribute('srcset') || '';

        if (src && !src.startsWith('data:')) {
          imageUrl = src;
        } else if (dataSrc) {
          imageUrl = dataSrc;
        } else if (srcset) {
          const parts = srcset.split(',')[0].trim().split(/\s+/);
          if (parts.length > 0) {
            imageUrl = parts[0];
          }
        }
      }

      if (!title) {
        const h3 = card.querySelector('h3');
        if (h3) {
          title = (h3.textContent || '').trim();
        }
      }

      if (!title) continue;

      let tmdbId = '';
      let linkUrl = '';
      const buttons = card.querySelectorAll('button');
      for (const btn of buttons) {
        const msg = btn.getAttribute('data-msg') || '';
        const copyVal = btn.getAttribute('data-copy') || '';
        if (msg.includes('TMDB')) {
          tmdbId = copyVal;
        } else if (msg.includes('Link')) {
          linkUrl = copyVal;
        }
      }

      let tipo = '';
      let year = '';
      const spans = card.querySelectorAll('div.mt-3 span');
      for (const span of spans) {
        const text = (span.textContent || '').trim();
        if (!text) continue;
        if (text.length === 4 && (text.startsWith('1') || text.startsWith('2'))) {
          if (!isNaN(parseInt(text, 10))) {
            year = text;
            continue;
          }
        }
        tipo = text;
      }

      if (!tipo && !year) {
        const metaDiv = card.querySelector('div.mt-3');
        if (metaDiv) {
          const text = (metaDiv.textContent || '').trim();
          const parts = text.split('|').map((p) => p.trim()).filter(Boolean);
          if (parts.length > 0) {
            tipo = parts[parts.length - 1];
          }
          if (parts.length > 1) {
            year = parts[1];
          }
        }
      }

      let sfType = 'serie';
      if (linkUrl.includes('/filme/')) {
        sfType = 'filme';
      }

      const key = tmdbId || title;
      if (seen.has(key)) continue;
      seen.add(key);

      if (!tipo) {
        tipo = sfType === 'filme' ? 'Filme' : 'Série';
      }

      let catalogType: MediaCatalogType = 'TV';
      const lowerType = tipo.toLowerCase();
      if (sfType === 'filme') {
        catalogType = 'MOVIE';
      } else if (lowerType.includes('anime')) {
        catalogType = 'ANIME';
      } else if (lowerType.includes('tv') || lowerType.includes('série') || lowerType.includes('serie')) {
        catalogType = 'TV';
      }

      results.push({
        id: `${sfType}/${tmdbId}`,
        title,
        thumbnailUrl: this.normalizeImage(imageUrl),
        catalogType,
        providerId: this.id,
      });
    }

    return results;
  }

  public async fetchContentUnits(mediaId: string, _language?: import('../types/index.js').ContentLanguage): Promise<IContentUnit[]> {
    const parts = mediaId.split('/');
    const sfType = parts[0];
    const tmdbId = parts[1];

    if (sfType === 'filme') {
      return [
        {
          id: `filme/${tmdbId}`,
          title: 'Movie',
          number: 1,
          language: 'sub',
        },
      ];
    }

    const playerPageUrl = `${this.baseUrl}/serie/${tmdbId}`;
    const response = await this.http.get(playerPageUrl, {
      headers: { Referer: `${this.baseUrl}/` },
    });

    if (response.status !== 200) {
      throw new Error(`Failed to load episodes for series ${tmdbId}`);
    }

    const html = await response.text();
    const match = html.match(/var ALL_EPISODES\s*=\s*(\{.+?\});/);
    if (!match) {
      return [];
    }

    let allEpisodes: Record<string, SuperFlixEpisode[]>;
    try {
      allEpisodes = JSON.parse(match[1]);
    } catch (e) {
      throw new Error(`Failed to parse ALL_EPISODES JSON: ${(e as Error).message}`);
    }

    const utcNow = new Date();
    const todayTimestamp = Date.UTC(
      utcNow.getUTCFullYear(),
      utcNow.getUTCMonth(),
      utcNow.getUTCDate()
    );

    const units: IContentUnit[] = [];

    for (const seasonNumber of Object.keys(allEpisodes)) {
      const episodes = allEpisodes[seasonNumber];
      for (const ep of episodes) {
        if (!ep.air_date || ep.air_date === 'null') continue;

        // Skip future episodes
        const airParts = ep.air_date.split('-');
        if (airParts.length === 3) {
          const airTimestamp = Date.UTC(
            parseInt(airParts[0], 10),
            parseInt(airParts[1], 10) - 1,
            parseInt(airParts[2], 10)
          );
          if (airTimestamp > todayTimestamp) {
            continue;
          }
        }

        const episodeNum = parseFloat(String(ep.epi_num));
        const seasonNum = parseInt(seasonNumber, 10);
        
        units.push({
          id: `serie/${tmdbId}/${seasonNumber}/${ep.epi_num}`,
          title: `Season ${seasonNum} Episode ${ep.epi_num}${ep.title ? `: ${ep.title}` : ''}`,
          number: episodeNum,
          language: 'sub',
        });
      }
    }

    return units;
  }

  public async resolveStream(unitId: string, _language?: import('../types/index.js').ContentLanguage): Promise<ResolvedMediaStream> {
    const parts = unitId.split('/');
    const sfType = parts[0];
    const tmdbId = parts[1];

    let playerPath = `/${sfType}/${tmdbId}`;
    if (sfType === 'serie') {
      const season = parts[2];
      const episode = parts[3];
      playerPath += `/${season}/${episode}`;
    }

    const playerPageUrl = `${this.baseUrl}${playerPath}`;
    const response = await this.http.get(playerPageUrl, {
      headers: {
        Referer: `${this.baseUrl}/`,
        'Sec-Fetch-Dest': 'iframe',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'cross-site',
      },
    });

    if (response.status !== 200) {
      throw new Error(`Failed to load player page: ${response.status}`);
    }

    let html = await response.text();
    const hasTokens = html.includes('PAGE_TOKEN') && html.includes('INITIAL_CONTENT_ID');
    const isRestricted = html.includes('Visualização Externa') || html.includes('Acesso Restrito') || html.includes('embedCode');

    if (
      !hasTokens && (
        isRestricted ||
        html.includes('cloudflare') ||
        html.includes('captcha') ||
        html.includes('Verificação') ||
        html.includes('cf-challenge') ||
        response.status === 403 ||
        response.status === 503
      )
    ) {
      if (!this.flare) {
        throw new Error(
          'SuperFlix requires FlareSolverr to bypass Cloudflare/Turnstile protection. Please configure FlareSolverrClient in SuperFlixProvider options.'
        );
      }

      console.log('SuperFlixProvider: Restricted access or Cloudflare detected. Activating FlareSolverr...');

      // 1. Solve Turnstile on the initial page to get cookies and the Acesso Restrito page HTML
      const solvedPageRes = await this.flare.get(playerPageUrl, {
        headers: { Referer: 'https://redecanais.buzz/' },
      });

      const solvedPageHtml = solvedPageRes.text();

      // 2. Extract Turnstile iframe URL
      const embedCodeMatch = solvedPageHtml.match(/id="embedCode"[^>]*>&lt;iframe\s+[^>]*src="([^"]+)"/i);
      if (!embedCodeMatch) {
        throw new Error('SuperFlix: Could not find Turnstile iframe source URL in the solved page.');
      }

      const rawIframeUrl = embedCodeMatch[1];
      const iframeUrl = rawIframeUrl.replace(/&amp;/g, '&');

      // 3. Resolve the Turnstile iframe via FlareSolverr
      const solvedIframeRes = await this.flare.get(iframeUrl, {
        headers: { Referer: playerPageUrl },
      });

      html = solvedIframeRes.text();
    }

    const csrfMatch = html.match(/var CSRF_TOKEN\s*=\s*"([^"]*)"/);
    const pageTokenMatch = html.match(/var PAGE_TOKEN\s*=\s*"([^"]+)"/);
    const contentIdMatch = html.match(/var INITIAL_CONTENT_ID\s*=\s*(\d+)/);
    const contentTypeMatch = html.match(/var CONTENT_TYPE\s*=\s*"([^"]+)"/);

    if (!pageTokenMatch || !contentIdMatch || !contentTypeMatch) {
      throw new Error('Failed to extract tokens from player page HTML');
    }

    const csrf = csrfMatch ? csrfMatch[1] : '';
    const pageToken = pageTokenMatch[1];
    const contentId = contentIdMatch[1];
    const contentType = contentTypeMatch[1];

    // 1. Call bootstrap
    const bootstrapUrl = `${this.baseUrl}/player/bootstrap`;
    const formParams = {
      contentid: contentId,
      type: contentType,
      season: sfType === 'serie' ? parts[2] : '1',
      episode: sfType === 'serie' ? parts[3] : '',
      _token: csrf,
      page_token: pageToken,
      pageToken: pageToken,
    };

    let bootstrapJson: any;
    if (this.flare) {
      const res = await this.flare.post(bootstrapUrl, formParams, {
        headers: {
          Referer: playerPageUrl,
          'X-Page-Token': pageToken,
          'X-Requested-With': 'XMLHttpRequest',
          Origin: this.baseUrl,
        },
      });
      bootstrapJson = res.json();
    } else {
      const formParamsUrl = new URLSearchParams(formParams);
      const bootstrapResponse = await this.http.post(bootstrapUrl, formParamsUrl, {
        headers: {
          Referer: `${this.baseUrl}/`,
          'X-Page-Token': pageToken,
          'X-Requested-With': 'XMLHttpRequest',
          Origin: this.baseUrl,
        },
      });
      if (bootstrapResponse.status !== 200) {
        throw new Error(`Bootstrap failed with status ${bootstrapResponse.status}`);
      }
      bootstrapJson = await bootstrapResponse.json();
    }

    const options = bootstrapJson.data?.options || [];
    if (options.length === 0) {
      throw new Error('No streaming servers available for this content');
    }

    // Pick first non-fallback server
    let videoId = '';
    for (const opt of options) {
      const idStr = String(opt.ID);
      if (!idStr.startsWith('fallback')) {
        videoId = idStr;
        break;
      }
    }
    if (!videoId && options.length > 0) {
      videoId = String(options[0].ID);
    }

    if (!videoId) {
      throw new Error('No valid video ID found in bootstrap options');
    }

    // 2. Call source
    const sourceUrl = `${this.baseUrl}/player/source`;
    const sourceParams = {
      video_id: videoId,
      page_token: pageToken,
      host: '',
      site: '',
      _token: csrf,
    };

    let sourceJson: any;
    if (this.flare) {
      const res = await this.flare.post(sourceUrl, sourceParams, {
        headers: {
          Referer: playerPageUrl,
          'X-Page-Token': pageToken,
          'X-Requested-With': 'XMLHttpRequest',
          Origin: this.baseUrl,
        },
      });
      sourceJson = res.json();
    } else {
      const sourceResponse = await this.http.post(sourceUrl, new URLSearchParams(sourceParams), {
        headers: {
          Referer: `${this.baseUrl}/`,
          'X-Page-Token': pageToken,
          'X-Requested-With': 'XMLHttpRequest',
          Origin: this.baseUrl,
        },
      });
      if (sourceResponse.status !== 200) {
        throw new Error(`Source API failed with status ${sourceResponse.status}`);
      }
      sourceJson = await sourceResponse.json();
    }

    const videoRedirectUrl = sourceJson.data?.video_url;
    if (!videoRedirectUrl) {
      throw new Error('No video redirect URL found in source response');
    }

    // 3. Resolve redirect to the external player
    let playerHtml = '';
    if (this.flare) {
      const res = await this.flare.get(videoRedirectUrl, {
        headers: { Referer: playerPageUrl },
      });
      playerHtml = res.text();
    } else {
      const redirectRes = await this.http.get(videoRedirectUrl, {
        redirect: 'follow',
        headers: { Referer: `${this.baseUrl}/` },
      });
      playerHtml = await redirectRes.text();
    }

    // 4. Extract SOURCES variable
    const sourcesMatch = playerHtml.match(/var SOURCES\s*=\s*(\[.+?\]);/);
    if (!sourcesMatch) {
      throw new Error('Failed to parse sources from player HTML');
    }

    let parsedSources: any[] = [];
    try {
      parsedSources = JSON.parse(sourcesMatch[1]);
    } catch (e) {
      throw new Error(`Failed to parse SOURCES JSON: ${(e as Error).message}`);
    }

    if (parsedSources.length === 0 || !parsedSources[0].src) {
      throw new Error('No valid video stream source found in player page');
    }

    const rawStreamUrl = parsedSources[0].src;
    const isHLS = rawStreamUrl.includes('.m3u8');
    const quality = 'auto';

    return {
      type: 'video',
      streams: [
        {
          sourceUrl: rawStreamUrl,
          isHLS,
          quality,
          headers: {
            Referer: `${this.baseUrl}/`,
            'User-Agent':
              this.http.getDefaultHeaders()['User-Agent'] ||
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          },
        },
      ],
    };
  }
}

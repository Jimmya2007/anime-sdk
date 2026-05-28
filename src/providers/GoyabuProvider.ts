import { BaseProvider } from './BaseProvider.js';
import { HttpClient } from '../transport/http.js';
import { DomRegistry } from '../transport/dom.js';
import {
  IMediaSearchResult,
  IContentUnit,
  ResolvedMediaStream,
  MediaCatalogType,
  IVideoPayload,
} from '../types/index.js';

export interface GoyabuOptions {
  baseUrl?: string;
}

export class GoyabuProvider extends BaseProvider {
  public readonly id = 'goyabu';
  public readonly supportedTypes: MediaCatalogType[] = ['ANIME'];
  private baseUrl = 'https://goyabu.io';

  constructor(http: HttpClient, options: GoyabuOptions = {}) {
    super(http);
    if (options.baseUrl) {
      this.baseUrl = options.baseUrl;
    }
    if (!this.http.getDefaultHeaders()['User-Agent']) {
      this.http.setUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      );
    }
  }

  /**
   * Search for anime on Goyabu.
   * Leverages the HTML search fallback method.
   */
  public async search(query: string): Promise<IMediaSearchResult[]> {
    // Replace spaces, hyphens and underscores with plus for search query formatting
    const normalized = query.trim().replace(/[-_]/g, ' ');
    const searchUrl = `${this.baseUrl}/?s=${encodeURIComponent(normalized)}`;

    const response = await this.http.get(searchUrl);
    if (response.status !== 200) {
      throw new Error(`Goyabu search failed with status ${response.status}`);
    }

    const html = await response.text();
    const doc = DomRegistry.parse(html);
    const results: IMediaSearchResult[] = [];

    // Select article search cards
    const cards = doc.querySelectorAll('article.boxAN') || doc.querySelectorAll('article');
    for (const card of cards) {
      const a = card.querySelector('a');
      if (!a) continue;

      const href = a.getAttribute('href') || '';
      if (!href || !href.includes('/anime/')) continue;

      const id = href.startsWith('http') ? new URL(href).pathname : href;
      
      const titleElem = card.querySelector('.title') || card.querySelector('h3') || card.querySelector('h2');
      let title = titleElem ? (titleElem.textContent || '').trim() : '';

      const img = card.querySelector('img');
      if (!title && img) {
        title = (img.getAttribute('alt') || img.getAttribute('title') || '').trim();
      }

      if (!title) continue;

      let thumbnailUrl = undefined;
      if (img) {
        const src = img.getAttribute('src') || img.getAttribute('data-src') || '';
        if (src) {
          thumbnailUrl = src.startsWith('http') ? src : `${this.baseUrl}${src.startsWith('/') ? '' : '/'}${src}`;
        }
      }

      results.push({
        id,
        title,
        thumbnailUrl,
        catalogType: 'ANIME',
        providerId: this.id,
      });
    }

    return results;
  }

  /**
   * Fetch all content units (episodes) for a given Goyabu anime URL slug (e.g. "/anime/...").
   */
  public async fetchContentUnits(mediaId: string, _language?: import('../types/index.js').ContentLanguage): Promise<IContentUnit[]> {
    const fullUrl = `${this.baseUrl}${mediaId.startsWith('/') ? '' : '/'}${mediaId}`;
    const response = await this.http.get(fullUrl);
    if (response.status !== 200) {
      throw new Error(`Failed to fetch Goyabu details page: ${response.status}`);
    }

    const html = await response.text();
    const units: IContentUnit[] = [];

    // Regex patterns matching JavaScript array of episodes
    const patterns = [
      /(?:const|let|var)\s+allEpisodes\s*=\s*(\[[\s\S]*?\])\s*;/i,
      /episodes\s*[:=]\s*(\[[\s\S]*?\])/i,
      /"episodes"\s*:\s*(\[[\s\S]*?\])/i,
      /episodeList\s*[:=]\s*(\[[\s\S]*?\])/i,
      /episodios\s*[:=]\s*(\[[\s\S]*?\])/i,
    ];

    let foundArray = false;
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (!match) continue;

      try {
        const jsonStr = match[1];
        // Clean possible unquoted keys ({id:1} -> {"id":1}) or single quotes
        let cleaned = jsonStr.replace(/([,{\[\s]|^)(\w+)\s*:/g, '$1"$2":');
        cleaned = cleaned.replace(/'/g, '"');
        
        // Remove trailing commas before closing braces if any (JSON strict parsing)
        cleaned = cleaned.replace(/,\s*([\}\]])/g, '$1');

        const epData = JSON.parse(cleaned);
        if (Array.isArray(epData)) {
          for (let i = 0; i < epData.length; i++) {
            const ep = epData[i];
            const num = ep.episodio ? parseFloat(ep.episodio) : (i + 1);
            // Construct direct WordPress post URL using the ID
            const epId = ep.id || ep.ID;
            if (!epId) continue;

            units.push({
              id: `/?p=${epId}`,
              title: `Episódio ${num}`,
              number: num,
              language: 'sub',
            });
          }
          foundArray = true;
          break;
        }
      } catch (err) {
        // Fallback to next match
      }
    }

    // Fallback: parse static anchor tags from the details HTML page
    if (!foundArray || units.length === 0) {
      const doc = DomRegistry.parse(html);
      const anchors = doc.querySelectorAll('a');
      for (const a of anchors) {
        const href = a.getAttribute('href') || '';
        if (!href) continue;

        if (!href.includes('/?p=') && !href.includes('/episode/')) continue;
        if (!href.includes(this.baseUrl) && !href.startsWith('/')) continue;

        const epNumAttr = a.getAttribute('data-episode-number');
        const num = epNumAttr ? parseFloat(epNumAttr) : (units.length + 1);

        const id = href.startsWith('http') ? new URL(href).pathname + new URL(href).search : href;

        units.push({
          id,
          title: `Episódio ${num}`,
          number: num,
          language: 'sub',
        });
      }
    }

    return units.sort((a, b) => a.number - b.number);
  }

  /**
   * Resolve playback stream for a specific Goyabu content unit path.
   */
  public async resolveStream(unitId: string, _language?: import('../types/index.js').ContentLanguage): Promise<ResolvedMediaStream> {
    const fullUrl = `${this.baseUrl}${unitId.startsWith('/') ? '' : '/'}${unitId}`;
    const response = await this.http.get(fullUrl);
    if (response.status !== 200) {
      throw new Error(`Failed to fetch Goyabu episode page: ${response.status}`);
    }

    const html = await response.text();
    const videoSources: IVideoPayload[] = [];

    // Helper to map quality to standard type
    const mapQuality = (label: string | number): '1080p' | '720p' | '360p' | 'auto' => {
      const normalized = String(label).toLowerCase();
      if (normalized.includes('1080')) return '1080p';
      if (normalized.includes('720')) return '720p';
      if (normalized.includes('480') || normalized.includes('360')) return '360p';
      return 'auto';
    };

    // Strategy 1: Check elements in DOM (iframe or video)
    const doc = DomRegistry.parse(html);
    const iframe = doc.querySelector('iframe');
    const iframeSrc = iframe ? iframe.getAttribute('src') : null;
    if (iframeSrc) {
      videoSources.push({
        sourceUrl: iframeSrc,
        isHLS: iframeSrc.includes('.m3u8'),
        quality: 'auto',
        headers: { Referer: fullUrl },
      });
    }

    const videoSource = doc.querySelector('video source') || doc.querySelector('video[data-video-src]');
    const videoSrc = videoSource ? (videoSource.getAttribute('src') || videoSource.getAttribute('data-video-src')) : null;
    if (videoSrc) {
      videoSources.push({
        sourceUrl: videoSrc,
        isHLS: videoSrc.includes('.m3u8'),
        quality: 'auto',
        headers: { Referer: fullUrl },
      });
    }

    // Strategy 2: Extract playersData array or blogger tokens and decode via admin-ajax.php
    let bloggerToken = '';
    let bloggerUrlFallback = '';

    const playersDataMatch = html.match(/var\s+playersData\s*=\s*(\[.*?\])\s*;/i);
    if (playersDataMatch) {
      try {
        const cleaned = playersDataMatch[1].replace(/([,{\[\s]|^)(\w+)\s*:/g, '$1"$2":').replace(/'/g, '"');
        const players = JSON.parse(cleaned);
        if (Array.isArray(players) && players.length > 0) {
          bloggerToken = players[0].blogger_token || '';
          bloggerUrlFallback = players[0].url || '';
        }
      } catch (e) {
        // ignore
      }
    }

    if (!bloggerToken) {
      const tokenPatterns = [
        /blogger_token\s*[:=]\s*["']([^"']+)["']/i,
        /data-blogger-token\s*=\s*["']([^"']+)["']/i,
        /"blogger_token"\s*:\s*"([^"]+)"/i,
      ];
      for (const pattern of tokenPatterns) {
        const m = html.match(pattern);
        if (m) {
          bloggerToken = m[1];
          break;
        }
      }
    }

    if (bloggerToken) {
      try {
        const bodyParams = new URLSearchParams();
        bodyParams.append('action', 'decode_blogger_video');
        bodyParams.append('token', bloggerToken);

        const ajaxResponse = await this.http.post(
          `${this.baseUrl}/wp-admin/admin-ajax.php`,
          bodyParams,
          {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'X-Requested-With': 'XMLHttpRequest',
              Referer: fullUrl,
            },
          }
        );

        if (ajaxResponse.status === 200) {
          const ajaxText = await ajaxResponse.text();
          let decodedData: any;
          try {
            decodedData = JSON.parse(ajaxText);
          } catch (e) {
            // If body is raw URL string
            if (ajaxText.startsWith('http')) {
              videoSources.push({
                sourceUrl: ajaxText,
                isHLS: ajaxText.includes('.m3u8'),
                quality: 'auto',
                headers: { Referer: fullUrl },
              });
            }
          }

          if (decodedData && decodedData.data && Array.isArray(decodedData.data.play)) {
            for (const streamItem of decodedData.data.play) {
              if (streamItem.src) {
                videoSources.push({
                  sourceUrl: streamItem.src,
                  isHLS: streamItem.src.includes('.m3u8'),
                  quality: mapQuality(streamItem.size || 'auto'),
                  headers: { Referer: fullUrl },
                });
              }
            }
          }
        }
      } catch (err) {
        // Ignore AJAX failures and fallback to patterns
      }
    }

    // Strategy 3: Search script tags / HTML source for direct HLS/MP4 streams
    if (videoSources.length === 0) {
      const filePatterns = [
        /"file"\s*:\s*"(https?:\/\/[^"]+\.m3u8[^"]*)"/i,
        /"file"\s*:\s*"(https?:\/\/[^"]+\.mp4[^"]*)"/i,
        /src\s*[:=]\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i,
        /src\s*[:=]\s*["'](https?:\/\/[^"']+\.mp4[^"']*)["']/i,
        /source\s*[:=]\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i,
      ];

      for (const pattern of filePatterns) {
        const m = html.match(pattern);
        if (m && m[1]) {
          videoSources.push({
            sourceUrl: m[1],
            isHLS: m[1].includes('.m3u8'),
            quality: 'auto',
            headers: { Referer: fullUrl },
          });
        }
      }
    }

    // Strategy 4: Fallback to blogger URL directly
    if (videoSources.length === 0 && bloggerUrlFallback) {
      videoSources.push({
        sourceUrl: bloggerUrlFallback,
        isHLS: bloggerUrlFallback.includes('.m3u8'),
        quality: 'auto',
        headers: { Referer: fullUrl },
      });
    }

    if (videoSources.length === 0) {
      throw new Error(`Failed to extract Goyabu playback stream for episode: ${unitId}`);
    }

    return {
      type: 'video',
      streams: videoSources,
    };
  }
}

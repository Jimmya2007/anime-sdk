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

export interface AnimefireOptions {
  baseUrl?: string;
}

export class AnimefireProvider extends BaseProvider {
  public readonly id = 'animefire';
  public readonly supportedTypes: MediaCatalogType[] = ['ANIME'];
  private baseUrl = 'https://animefire.plus';

  constructor(http: HttpClient, options: AnimefireOptions = {}) {
    super(http);
    if (options.baseUrl) {
      this.baseUrl = options.baseUrl;
    }
    // Set a default User-Agent if none exists
    if (!this.http.getDefaultHeaders()['User-Agent']) {
      this.http.setUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      );
    }
  }

  /**
   * Search for anime on AnimeFire.
   * Matches Go reference SearchAnime method.
   */
  public async search(query: string): Promise<IMediaSearchResult[]> {
    // Normalize spaces to hyphens and convert to lowercase
    const querySlug = query.trim().toLowerCase().replace(/\s+/g, '-');
    const searchUrl = `${this.baseUrl}/pesquisar/${encodeURIComponent(querySlug)}`;

    const response = await this.http.get(searchUrl);
    if (response.status !== 200) {
      throw new Error(`AnimeFire search failed with status ${response.status}`);
    }

    const html = await response.text();
    const doc = DomRegistry.parse(html);
    const results: IMediaSearchResult[] = [];

    // Method 1: parse links inside .row.ml-1.mr-1 a
    const rowLinks = doc.querySelectorAll('.row.ml-1.mr-1 a');
    for (const a of rowLinks) {
      const href = a.getAttribute('href') || '';
      if (!href) continue;
      const title = (a.textContent || '').trim();
      if (!title) continue;

      const id = href.startsWith('http') ? new URL(href).pathname : href;
      results.push({
        id,
        title,
        catalogType: 'ANIME',
        providerId: this.id,
      });
    }

    // Method 2: parse .card_ani card listings
    const cards = doc.querySelectorAll('.card_ani');
    for (const card of cards) {
      const titleElem = card.querySelector('.ani_name a');
      if (!titleElem) continue;
      const title = (titleElem.textContent || '').trim();
      const href = titleElem.getAttribute('href') || '';
      if (!title || !href) continue;

      const id = href.startsWith('http') ? new URL(href).pathname : href;
      const imgElem = card.querySelector('.div_img img');
      let thumbnailUrl = undefined;
      if (imgElem) {
        const src = imgElem.getAttribute('src') || '';
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

    // Deduplicate results
    const seen = new Set<string>();
    return results.filter((r) => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    });
  }

  /**
   * Fetch all content units (episodes) for a given AnimeFire URL slug.
   * Matches Go reference GetAnimeEpisodes method.
   */
  public async fetchContentUnits(mediaId: string, _language?: import('../types/index.js').ContentLanguage): Promise<IContentUnit[]> {
    const fullUrl = `${this.baseUrl}${mediaId.startsWith('/') ? '' : '/'}${mediaId}`;
    const response = await this.http.get(fullUrl);
    if (response.status !== 200) {
      throw new Error(`Failed to fetch AnimeFire details page: ${response.status}`);
    }

    const html = await response.text();
    const doc = DomRegistry.parse(html);
    const anchors = doc.querySelectorAll('a.lEp');

    const units: IContentUnit[] = [];
    for (const a of anchors) {
      const text = (a.textContent || '').trim();
      const href = a.getAttribute('href') || '';
      if (!href) continue;

      // Extract episode number using regex matching e.g. "Episódio 01" or "Episódio 2"
      const epMatch = text.match(/epis[oó]dio\s+(\d+)/i) || text.match(/[\d\.]+/);
      const number = epMatch ? parseFloat(epMatch[1] || epMatch[0]) : 0;
      const id = href.startsWith('http') ? new URL(href).pathname : href;

      units.push({
        id,
        title: text || `Episode ${number}`,
        number,
        language: 'sub',
      });
    }

    // Sort episodes ascending by number
    return units.sort((a, b) => a.number - b.number);
  }

  /**
   * Resolve playback stream for a specific AnimeFire episode slug.
   * Matches Go reference GetEpisodeStreamURL method.
   */
  public async resolveStream(unitId: string, _language?: import('../types/index.js').ContentLanguage): Promise<ResolvedMediaStream> {
    const fullUrl = `${this.baseUrl}${unitId.startsWith('/') ? '' : '/'}${unitId}`;
    const response = await this.http.get(fullUrl);
    if (response.status !== 200) {
      throw new Error(`Failed to fetch AnimeFire episode page: ${response.status}`);
    }

    const html = await response.text();
    const doc = DomRegistry.parse(html);
    const videoSources: IVideoPayload[] = [];

    const mapQuality = (label: string): '1080p' | '720p' | '360p' | 'auto' => {
      const normalized = label.toLowerCase();
      if (normalized.includes('1080')) return '1080p';
      if (normalized.includes('720')) return '720p';
      if (normalized.includes('480') || normalized.includes('360')) return '360p';
      return 'auto';
    };

    // Method 1: Check elements with data-video-src attribute
    const dataSrcElements = doc.querySelectorAll('[data-video-src]');
    for (const el of dataSrcElements) {
      const src = el.getAttribute('data-video-src');
      if (!src) continue;
      const qualityAttr = el.getAttribute('data-quality') || 'auto';
      videoSources.push({
        sourceUrl: src,
        isHLS: src.includes('.m3u8'),
        quality: mapQuality(qualityAttr),
        headers: {
          Referer: fullUrl,
          'User-Agent': this.http.getDefaultHeaders()['User-Agent'] || '',
        },
      });
    }

    // Method 2: Check standard video elements
    if (videoSources.length === 0) {
      const sources = doc.querySelectorAll('video source');
      for (const s of sources) {
        const src = s.getAttribute('src');
        if (src) {
          videoSources.push({
            sourceUrl: src,
            isHLS: src.includes('.m3u8'),
            quality: 'auto',
            headers: {
              Referer: fullUrl,
              'User-Agent': this.http.getDefaultHeaders()['User-Agent'] || '',
            },
          });
        }
      }
    }

    if (videoSources.length === 0) {
      const video = doc.querySelector('video');
      const src = video ? video.getAttribute('src') : null;
      if (src) {
        videoSources.push({
          sourceUrl: src,
          isHLS: src.includes('.m3u8'),
          quality: 'auto',
          headers: {
            Referer: fullUrl,
            'User-Agent': this.http.getDefaultHeaders()['User-Agent'] || '',
          },
        });
      }
    }

    // Method 3: Blogger iframe
    if (videoSources.length === 0) {
      const iframes = doc.querySelectorAll('iframe');
      for (const iframe of iframes) {
        const src = iframe.getAttribute('src') || '';
        if (src.includes('blogger.com') || src.includes('blogspot.com')) {
          videoSources.push({
            sourceUrl: src,
            isHLS: false,
            quality: 'auto',
            headers: {
              Referer: fullUrl,
              'User-Agent': this.http.getDefaultHeaders()['User-Agent'] || '',
            },
          });
        }
      }
    }

    // Method 4: Search for raw MP4/M3U8 regex patterns or blogger tokens in HTML source
    if (videoSources.length === 0) {
      const mp4Regex = /(https?:\/\/[^"'\s<>]+?\.mp4(?:\?[^"'\s<>]*)?)/gi;
      const m3u8Regex = /(https?:\/\/[^"'\s<>]+?\.m3u8(?:\?[^"'\s<>]*)?)/gi;

      const m3u8Matches = html.match(m3u8Regex);
      if (m3u8Matches) {
        for (const match of m3u8Matches) {
          videoSources.push({
            sourceUrl: match,
            isHLS: true,
            quality: 'auto',
            headers: {
              Referer: fullUrl,
              'User-Agent': this.http.getDefaultHeaders()['User-Agent'] || '',
            },
          });
        }
      }

      const mp4Matches = html.match(mp4Regex);
      if (mp4Matches && videoSources.length === 0) {
        for (const match of mp4Matches) {
          videoSources.push({
            sourceUrl: match,
            isHLS: false,
            quality: 'auto',
            headers: {
              Referer: fullUrl,
              'User-Agent': this.http.getDefaultHeaders()['User-Agent'] || '',
            },
          });
        }
      }

      const bloggerMarker = /https:\/\/www\.blogger\.com\/video\.g\?token=[A-Za-z0-9_-]+/g;
      const bloggerMatches = html.match(bloggerMarker);
      if (bloggerMatches && videoSources.length === 0) {
        for (const match of bloggerMatches) {
          videoSources.push({
            sourceUrl: match,
            isHLS: false,
            quality: 'auto',
            headers: {
              Referer: fullUrl,
              'User-Agent': this.http.getDefaultHeaders()['User-Agent'] || '',
            },
          });
        }
      }
    }

    if (videoSources.length === 0) {
      throw new Error(`Failed to extract any playback video streams from AnimeFire episode: ${unitId}`);
    }

    return {
      type: 'video',
      streams: videoSources,
    };
  }
}

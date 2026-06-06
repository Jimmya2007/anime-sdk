import { BaseProvider } from './BaseProvider.js';
import { HttpClient } from '../transport/http.js';
import {
  IMediaSearchResult,
  IContentUnit,
  ResolvedMediaStream,
  MediaCatalogType,
  IUnitTracks,
} from '../types/index.js';
import { normalizeSubtitleEntries } from '../utils/subtitles.js';

const API_BASE = 'https://api.animeparadise.moe';
const STREAM_BASE = 'https://stream.animeparadise.moe';

export class AnimeParadiseProvider extends BaseProvider {
  public readonly id = 'animeparadise';
  public readonly supportedTypes: MediaCatalogType[] = ['ANIME'];

  constructor(http: HttpClient) {
    super(http);
  }

  async search(query: string): Promise<IMediaSearchResult[]> {
    const res = await this.http.get(`${API_BASE}/search?q=${encodeURIComponent(query)}&limit=20`);
    const json = (await res.json()) as any;
    const items: any[] = json?.data ?? [];
    return items.map((item) => ({
      id: item._id,
      title: item.alternativeTitle?.english ?? item.title,
      thumbnailUrl: item.posterImage?.medium ?? item.posterImage?.large,
      catalogType: 'ANIME' as const,
      providerId: this.id,
    }));
  }

  async fetchContentUnits(mediaId: string): Promise<IContentUnit[]> {
    const res = await this.http.get(`${API_BASE}/anime/${mediaId}/episode`);
    const json = (await res.json()) as any;
    const episodes: any[] = json?.data ?? [];
    return episodes.map((ep) => ({
      // encode uid and animeId so resolveStream can call /ep/{uid}?origin={animeId}
      id: `${ep.uid}:${mediaId}`,
      title: ep.title ?? `Episode ${ep.number}`,
      number: parseFloat(ep.number),
      availableLanguages: ['sub'] as const,
    }));
  }

  async resolveStream(unitId: string): Promise<ResolvedMediaStream> {
    const sep = unitId.lastIndexOf(':');
    if (sep < 0) throw new Error(`AnimeParadise: invalid unitId "${unitId}"`);
    const uid = unitId.slice(0, sep);
    const animeId = unitId.slice(sep + 1);

    const res = await this.http.get(`${API_BASE}/ep/${uid}?origin=${animeId}`);
    const json = (await res.json()) as any;
    const episode = json?.data?.episode;
    if (!episode?.streamLink) throw new Error('AnimeParadise: no streamLink in response');

    const streamUrl = `${STREAM_BASE}/m3u8?url=${encodeURIComponent(episode.streamLink)}`;
    const subtitles = normalizeSubtitleEntries(episode.subData);

    return {
      type: 'video',
      streams: [
        {
          sourceUrl: streamUrl,
          isHLS: true,
          quality: 'auto',
          language: 'sub',
          headers: { Referer: 'https://animeparadise.moe/' },
          ...(subtitles.length > 0 ? { subtitles } : {}),
        },
      ],
    };
  }

  /**
   * Fetch the subtitle/quality availability for a unit without resolving the
   * stream itself. AnimeParadise exposes `subData` on the `/ep/:uid` response,
   * so this is one cheap round-trip — useful for populating a subtitle selector
   * before the user hits play.
   */
  async fetchUnitTracks(unitId: string): Promise<IUnitTracks> {
    const sep = unitId.lastIndexOf(':');
    if (sep < 0) throw new Error(`AnimeParadise: invalid unitId "${unitId}"`);
    const uid = unitId.slice(0, sep);
    const animeId = unitId.slice(sep + 1);

    const res = await this.http.get(`${API_BASE}/ep/${uid}?origin=${animeId}`);
    const json = (await res.json()) as { data?: { episode?: { subData?: unknown } } };
    const subtitles = normalizeSubtitleEntries(json?.data?.episode?.subData);
    // AnimeParadise serves a single auto-ladder HLS manifest per episode — we
    // don't know the rendition list without fetching the master, so 'auto' is
    // the only signal we can give up-front.
    return { subtitles, qualities: ['auto'] };
  }
}

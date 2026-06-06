export type MediaCatalogType = 'ANIME' | 'MOVIE' | 'TV' | 'MANGA' | 'LIVE_TV';

/**
 * Language/translation type for anime content.
 * - 'sub': Subtitled (original Japanese audio with subtitles)
 * - 'dub': Dubbed (localized audio track, typically English)
 * - 'raw': No subtitles, original audio only
 */
export type ContentLanguage = 'sub' | 'dub' | 'raw';

export interface IMediaSearchResult {
  id: string;
  title: string;
  thumbnailUrl?: string;
  catalogType: MediaCatalogType;
  providerId: string;
  /** Languages available for this title (sub/dub/raw). Omitted if unknown. */
  availableLanguages?: ContentLanguage[];
}

export interface IContentUnit {
  id: string; // Provider-specific internal ID (language-agnostic when possible)
  title: string;
  number: number;
  /**
   * Translation types this unit can be played in. Providers return a single
   * unified episode list — callers pick which translation to resolve at
   * `resolveStream` time.
   */
  availableLanguages: ContentLanguage[];
  /**
   * Subtitle tracks known to be available for this unit, when the provider
   * exposes that at episode-list time. Each entry carries the same shape as
   * {@link ISubtitleTrack} *minus* the URL (URLs are only resolved during
   * `resolveStream` / `fetchUnitTracks`). Omitted when the provider can't
   * surface this without per-unit resolution.
   */
  availableSubtitles?: ISubtitleAvailability[];
  /**
   * Video qualities known to be available for this unit, when the provider
   * exposes that at episode-list time. Omitted when not available.
   */
  availableQualities?: IVideoPayload['quality'][];
}

export interface ISubtitleAvailability {
  language: string;
  label: string;
  format?: 'vtt' | 'srt' | 'ass';
}

export interface ISubtitleTrack extends ISubtitleAvailability {
  url: string;
}

/**
 * Per-unit track metadata returned from `fetchUnitTracks`. Lets a consumer
 * introspect which subtitle/video tracks exist for an episode *without*
 * triggering a full stream resolution (which is often the slowest step).
 */
export interface IUnitTracks {
  subtitles: ISubtitleTrack[];
  qualities: IVideoPayload['quality'][];
}

export interface IVideoPayload {
  sourceUrl: string;
  isHLS: boolean;
  quality: '1080p' | '720p' | '480p' | '360p' | 'auto';
  /** The translation type of this stream (sub/dub/raw) */
  language?: ContentLanguage;
  headers?: Record<string, string>;
  subtitles?: ISubtitleTrack[];
}

export interface IMangaPayload {
  imageUrls: string[];
  headers?: Record<string, string>;
}

export type ResolvedMediaStream =
  | { type: 'video'; streams: IVideoPayload[] }
  | { type: 'manga'; pages: IMangaPayload }
  | { type: 'live'; stream: IVideoPayload };

export interface IDomElement {
  querySelector(selector: string): IDomElement | null;
  querySelectorAll(selector: string): IDomElement[];
  getAttribute(name: string): string | null;
  readonly textContent: string | null;
  readonly outerHTML: string;
  readonly innerHTML: string;
}

export interface IDomParser {
  parse(html: string): IDomElement;
}

/**
 * Minimal cache contract the SDK consumes — bring whatever store you want
 * (in-memory Map, Redis, SQLite, edge KV). Both methods may be async; the
 * SDK awaits them either way.
 *
 * Keys are stable, namespaced strings produced by the server layer
 * (`search:<providerId>:<query>`, `content:<providerId>:<mediaId>`,
 * `stream:<providerId>:<unitId>:<lang>`, `tracks:<providerId>:<unitId>:<lang>`).
 * Consumers can inspect the prefix to pick a TTL or refuse to cache
 * particular endpoints (e.g. `/stream` when upstream URLs carry signed
 * expiries).
 *
 * `get` returns `undefined` for a miss; any other value (including `null`)
 * counts as a hit and is served as-is.
 */
export interface SdkCache {
  get(key: string): unknown | Promise<unknown>;
  set(key: string, value: unknown): void | Promise<void>;
}

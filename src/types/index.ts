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
  id: string; // Provider-specific internal ID
  title: string;
  number: number;
  /** The translation type for this specific content unit */
  language: ContentLanguage;
}

export interface IVideoPayload {
  sourceUrl: string;
  isHLS: boolean;
  quality: '1080p' | '720p' | '480p' | '360p' | 'auto';
  /** The translation type of this stream (sub/dub/raw) */
  language?: ContentLanguage;
  headers?: Record<string, string>;
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

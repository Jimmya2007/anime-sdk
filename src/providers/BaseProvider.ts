import { HttpClient } from '../transport/http.js';
import {
  IMediaSearchResult,
  IContentUnit,
  ResolvedMediaStream,
  MediaCatalogType,
  ContentLanguage,
} from '../types/index.js';

export abstract class BaseProvider {
  abstract readonly id: string;
  abstract readonly supportedTypes: MediaCatalogType[];

  constructor(protected http: HttpClient) {}

  abstract search(query: string): Promise<IMediaSearchResult[]>;

  /**
   * Fetch available content units (episodes/chapters) for the given media ID.
   * @param mediaId - Provider-specific media identifier
   * @param language - Preferred translation type. Providers that support sub/dub
   *   will return units for that language track. Falls back to 'sub' if omitted.
   */
  abstract fetchContentUnits(mediaId: string, language?: ContentLanguage): Promise<IContentUnit[]>;

  /**
   * Resolve a playback stream for the given content unit ID.
   * @param unitId - Provider-specific content unit identifier
   * @param language - Preferred translation type for stream resolution.
   */
  abstract resolveStream(unitId: string, language?: ContentLanguage): Promise<ResolvedMediaStream>;
}

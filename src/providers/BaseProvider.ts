import { HttpClient } from '../transport/http.js';
import {
  IMediaSearchResult,
  IContentUnit,
  ResolvedMediaStream,
  MediaCatalogType,
  ContentLanguage,
  IUnitTracks,
} from '../types/index.js';

export abstract class BaseProvider {
  abstract readonly id: string;
  abstract readonly supportedTypes: MediaCatalogType[];

  constructor(protected http: HttpClient) {}

  abstract search(query: string): Promise<IMediaSearchResult[]>;

  /**
   * Fetch available content units (episodes/chapters) for the given media ID.
   * Returns a unified list across all translations. Units may advertise which
   * languages they can be played in via {@link IContentUnit.availableLanguages},
   * if known ahead of time. Callers pick the translation when calling `resolveStream`.
   */
  abstract fetchContentUnits(mediaId: string): Promise<IContentUnit[]>;

  /**
   * Resolve a playback stream for the given content unit ID.
   * @param unitId - Provider-specific content unit identifier
   * @param language - Preferred translation type for stream resolution.
   */
  abstract resolveStream(unitId: string, language?: ContentLanguage): Promise<ResolvedMediaStream>;

  /**
   * Optional: list the subtitle/quality tracks available for a single unit
   * without resolving the playable stream. Implement when the provider can
   * expose this cheaper than `resolveStream` (e.g. a metadata endpoint that
   * skips the slow video-source extraction).
   *
   * Consumers building a UI can call this to populate a subtitle selector
   * before the user commits to playback.
   */
  fetchUnitTracks?(unitId: string, language?: ContentLanguage): Promise<IUnitTracks>;
}

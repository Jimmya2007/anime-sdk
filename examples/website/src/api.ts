const API = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api';

const get = (path: string, params: Record<string, string>) =>
  fetch(`${API}${path}?${new URLSearchParams(params)}`).then((r) => {
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return r.json();
  });

export const search = (provider: string, q: string) => get('/search', { provider, q });

export const content = (provider: string, mediaId: string, language: string) =>
  get('/content', { provider, mediaId, language });

export const stream = (provider: string, unitId: string, language: string) =>
  get('/stream', { provider, unitId, language });

// Types matching IVideoPayload / ResolvedMediaStream from the SDK
export type Lang = 'sub' | 'dub' | 'raw';

export interface SearchResult {
  id: string;
  title: string;
  catalogType: string;
  availableLanguages?: Lang[];
}

export interface Episode {
  id: string;
  title: string;
  number: number;
  language: Lang;
}

export interface VideoStream {
  sourceUrl: string;
  isHLS: boolean;
  quality: string;
  language?: Lang;
  headers?: Record<string, string>;
}

export interface ResolvedStream {
  type: 'video' | 'manga' | 'live';
  streams?: VideoStream[];
}

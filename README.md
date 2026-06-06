# ani-sdk

A small TypeScript SDK for searching anime, listing episodes, and resolving
direct stream URLs (with subtitle tracks). Four providers, a handful of
reusable embed extractors, a pluggable HTTP transport, and an optional HTTP
server with a stream/subtitle proxy and a bring-your-own cache hook.

## Providers

| ID              | Site                | Languages   | Subtitles | What it scrapes                                                                                                                                 |
| --------------- | ------------------- | ----------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `animeparadise` | `animeparadise.moe` | sub         | yes       | REST API at `api.animeparadise.moe`; episode carries a signed `streamLink` token; streamed as multi-quality HLS via `stream.animeparadise.moe`. |
| `allmanga`      | `allmanga.to`       | sub, dub    | no        | AllAnime GraphQL → AES-CTR `tobeparsed` payload → Mp4Upload extractor (with `clock.json` fallback for the wixmp/sharepoint sources).            |
| `gogoanime`     | `anineko.to`        | sub         | no        | Page scraping; vibeplayer embed → `master.m3u8` via `GenericHlsExtractor` (sequential, stops on first success).                                 |
| `goyabu`        | `goyabu.io`         | pt-br (dub) | no        | Pulls the Blogger token from `playersData`, then calls Google's `batchexecute` endpoint to recover the `googlevideo.com` URL.                   |

Every provider has a live E2E test that searches, picks an episode, resolves
the stream, and captures a real video frame ~5s in with ffmpeg.

## Architecture

```
src/
├── transport/
│   ├── http.ts              HttpClient: fetch + curl fallback, proxy routing
│   ├── flaresolverr.ts      FlareSolverrClient: optional CF/DDoS-Guard bypass
│   ├── dom.ts               DOMParser registry (auto-registers linkedom in Node)
│   └── hlsUtils.ts          Rewrite m3u8 chunk URLs through a proxy
├── extractors/
│   ├── Mp4UploadExtractor   Direct mp4 from www.mp4upload.com
│   ├── BloggerExtractor     Google batchexecute → googlevideo URLs
│   ├── VidstreamingExtractor  Legacy Gogo encrypt-ajax flow
│   └── GenericHlsExtractor  Best-effort m3u8/mp4 scrape from an embed page
├── providers/
│   ├── AnimeParadiseProvider
│   ├── AllmangaProvider
│   ├── GogoanimeProvider
│   └── GoyabuProvider
├── server/index.ts          startServer: HTTP API + /proxy + optional SdkCache
├── types/index.ts           IMediaSearchResult, IContentUnit, ISubtitleTrack,
│                            IUnitTracks, ResolvedMediaStream, SdkCache, …
└── utils/
    ├── crypto.ts            AES-CBC + AES-CTR helpers
    └── subtitles.ts         normalizeSubtitleEntries, proxifySubtitleUrl
```

A provider is just a class with `search`, `fetchContentUnits`, and
`resolveStream`. `fetchContentUnits` is language-agnostic — it returns one
unified list and each `IContentUnit` carries `availableLanguages` so the
caller can pick at `resolveStream` time. Providers may optionally implement
`fetchUnitTracks(unitId, language?)` to expose subtitle/quality metadata
cheaply (no full stream resolution). Extractors are stateless and take a
`HttpClient`, so you can mix and match (or use the extractors on their own).

## Usage

```ts
import { HttpClient, AllmangaProvider } from 'ani-sdk';

const http = new HttpClient({ timeoutMs: 25_000 });
const provider = new AllmangaProvider(http);

const results = await provider.search('Frieren');
const target = results.find((r) => r.title.toLowerCase().includes("beyond journey's end"))!;

// One call returns all episodes; each one advertises its languages.
const units = await provider.fetchContentUnits(target.id);
console.log(units[0].availableLanguages); // e.g. ['sub', 'dub']

// Pick the translation when you resolve.
const stream = await provider.resolveStream(units[0].id, 'sub');

if (stream.type === 'video') {
  // streams are sorted best-first; iterate if the top one 4xx's.
  for (const s of stream.streams) {
    console.log(s.quality, s.isHLS ? 'HLS' : 'MP4', s.sourceUrl);
    for (const t of s.subtitles ?? []) console.log(' sub:', t.language, t.label, t.url);
  }
}
```

### HTTP server with proxy + cache

```ts
import { HttpClient, startServer, AllmangaProvider, AnimeParadiseProvider } from 'ani-sdk';

const store = new Map(); // satisfies the SdkCache get/set contract
const cache = {
  get: (key) => store.get(key),
  set: (key, value) => void store.set(key, value),
};

startServer({
  providers: [new AllmangaProvider(new HttpClient()), new AnimeParadiseProvider(new HttpClient())],
  port: 3000,
  proxy: true, // /search, /content, /stream, /tracks, /proxy
  cache, // memoize provider calls by namespaced key
});
```

Routes: `GET /search`, `GET /content`, `GET /stream`, `GET /tracks`
(returns 501 when the provider has no cheap metadata path), and
`GET /proxy` for stream + subtitle fetching with header forwarding and
auto-rewritten HLS manifests. Subtitle URLs in `/stream` and `/tracks`
responses are automatically routed through `/proxy` so browsers don't hit
CORS / `Content-Type` issues with VTT files.

### Direct extractor use

Extractors work standalone — hand them an embed URL from any source and
they'll return a list of `IVideoPayload` (or an empty array if they can't
recover a direct stream).

```ts
import { HttpClient, BloggerExtractor } from 'ani-sdk';

const blogger = new BloggerExtractor(new HttpClient());
const streams = await blogger.extract('https://www.blogger.com/video.g?token=AD6v5dw…');
```

## Tests

```bash
# Everything (unit + live e2e, ~60s total)
npx vitest run

# Just the live providers
npx vitest run tests/e2e
```

The E2E suite is intentionally not mocked. Each test:

1. Searches a popular title (`Frieren` for AllManga/Gogoanime, `Naruto`
   Clássico for Goyabu).
2. Picks a mainline entry, fetches episodes, resolves a stream.
3. Walks the candidate list via `captureStreamScreenshot`, which:
   - probes a URL with a Range GET (Content-Type + MP4 `ftyp` magic) to tell
     embed pages from direct video bytes,
   - scrapes embed HTML for an `.m3u8`/`.mp4` URL when needed,
   - downloads an HLS segment ~5s in and runs ffmpeg locally on it
     (PNG-wrapped segments are stripped before decoding), or
   - hands plain MP4 URLs straight to ffmpeg with `-user_agent`/`-referer`,
4. Asserts the resulting PNG is >1KB before passing.

Screenshots land in `scratch/screenshots/screenshot_<provider>.png`.
`scratch/` is gitignored.

## Requirements

- Node 20+ (uses `fetch`, `globalThis.crypto.subtle`, top-level await in
  tests).
- `ffmpeg` on `PATH` for the E2E suite.
- FlareSolverr (optional) for any provider you write that needs CF bypass;
  see `FLARESOLVERR.md` and `docker-compose.yml`.

## License

MIT

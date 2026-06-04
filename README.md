# ani-sdk

A small TypeScript SDK for searching anime, listing episodes, and resolving
direct stream URLs. Three providers, a handful of reusable embed extractors,
and a pluggable HTTP transport.

## Providers

| ID           | Site           | Languages    | What it scrapes                                                   |
|--------------|----------------|--------------|-------------------------------------------------------------------|
| `allmanga`   | `allmanga.to`  | sub, dub     | AllAnime GraphQL → AES-CTR `tobeparsed` payload → Mp4Upload extractor (with `clock.json` fallback for the wixmp/sharepoint sources). |
| `gogoanime`  | `anineko.to`   | sub          | Page scraping; the screenshot helper handles the vibeplayer embed → `master.m3u8`. |
| `goyabu`     | `goyabu.io`    | pt-br (dub)  | Pulls the Blogger token from `playersData`, then calls Google's `batchexecute` endpoint to recover the `googlevideo.com` URL. |

Every provider has a live E2E test that searches, picks an episode, resolves
the stream, and captures a real video frame ~5s in with ffmpeg.

### What used to be here

The earlier draft also shipped `AnimePahe`, `HiAnimes`, `AnimeFire`, and
`SuperFlix`. They were removed because each is broken from this network in a
different way:

| Provider     | Reason                                                                                                                             |
|--------------|------------------------------------------------------------------------------------------------------------------------------------|
| `AnimePahe`  | Search + episode list work via FlareSolverr, but `kwik.cx` (the stream host) returns *Cloudflare has blocked this request* even with a real browser session. |
| `HiAnimes`   | `hianimes.se` moved to an SPA — `/ajax/search` and `/ajax/v2/episode/*` return the full HTML shell, not JSON.                       |
| `AnimeFire`  | `animefire.plus` 403s through FlareSolverr (CF clearance never issued for our IP range).                                            |
| `SuperFlix`  | Different surface now: `superflixapi.fit` is a live-action library behind Turnstile, and the old `id="embedCode"` iframe scrape doesn't match. |

Anyone on a different network can revive them by reimplementing against the
current upstream. The architecture below is what they'd plug into.

## Architecture

```
src/
├── transport/
│   ├── http.ts              HttpClient: fetch + curl fallback, proxy routing
│   ├── flaresolverr.ts      FlareSolverrClient: optional CF/DDoS-Guard bypass
│   ├── dom.ts               Pluggable DOMParser (linkedom in Node)
│   └── hlsUtils.ts          Rewrite m3u8 chunk URLs through a proxy
├── extractors/
│   ├── Mp4UploadExtractor   Direct mp4 from www.mp4upload.com
│   ├── BloggerExtractor     Google batchexecute → googlevideo URLs
│   ├── VidstreamingExtractor  Legacy Gogo encrypt-ajax flow
│   └── GenericHlsExtractor  Best-effort m3u8/mp4 scrape from an embed page
├── providers/
│   ├── AllmangaProvider
│   ├── GogoanimeProvider
│   └── GoyabuProvider
├── types/index.ts           IMediaSearchResult, IContentUnit, ResolvedMediaStream, …
└── utils/crypto.ts          AES-CBC + AES-CTR helpers
```

A provider is just a class with `search`, `fetchContentUnits`, and
`resolveStream`. Extractors are stateless and take a `HttpClient`, so you can
mix and match (or use the extractors on their own).

## Usage

```ts
import { HttpClient, AllmangaProvider } from 'ani-sdk';
import { DOMParser as LinkeDomParser } from 'linkedom';

// Most providers scrape HTML, which needs a DOMParser in Node.
if (typeof globalThis.DOMParser === 'undefined') {
  (globalThis as any).DOMParser = LinkeDomParser;
}

const http = new HttpClient({ timeoutMs: 25_000 });
const provider = new AllmangaProvider(http);

const results = await provider.search('Frieren');
const target = results.find((r) =>
  r.title.toLowerCase().includes("beyond journey's end")
)!;

const units = await provider.fetchContentUnits(target.id, 'sub');
const stream = await provider.resolveStream(units[0].id);

if (stream.type === 'video') {
  // streams are sorted best-first; iterate if the top one 4xx's.
  for (const s of stream.streams) {
    console.log(s.quality, s.isHLS ? 'HLS' : 'MP4', s.sourceUrl);
  }
}
```

### Direct extractor use

Extractors work standalone — hand them an embed URL from any source and
they'll return a list of `IVideoPayload` (or an empty array if they can't
recover a direct stream).

```ts
import { HttpClient, BloggerExtractor } from 'ani-sdk';

const blogger = new BloggerExtractor(new HttpClient());
const streams = await blogger.extract(
  'https://www.blogger.com/video.g?token=AD6v5dw…',
);
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
- `linkedom` as a dev dep — registers a Node-side `DOMParser`.
- FlareSolverr (optional) for any provider you write that needs CF bypass;
  see `FLARESOLVERR.md` and `docker-compose.yml`.

## License

MIT

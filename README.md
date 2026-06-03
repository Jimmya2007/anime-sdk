# ani-sdk — Universal Anime Scraper SDK

A small, typed, dependency-light TypeScript SDK for searching anime, listing
episodes, and resolving direct stream URLs across multiple providers. Each
provider is wired to its own scraping path and the SDK ships with a handful of
generic embed extractors (`Mp4Upload`, `Blogger`, `Vidstreaming`,
`GenericHls`) you can reuse outside of providers.

## Status

All three providers below are exercised by live E2E tests; each test runs the
full pipeline (search → fetchContentUnits → resolveStream) and validates the
result by pulling a real frame ~5 seconds into the stream with ffmpeg.

| Provider ID  | Site              | Notes                                                                                  |
|--------------|-------------------|----------------------------------------------------------------------------------------|
| `allmanga`   | `allmanga.to`     | AllAnime GraphQL + tobeparsed AES-CTR decryption + XOR source decoding + Mp4Upload extractor. |
| `gogoanime`  | `anineko.to`      | Direct page scraping; embed URLs are extracted on the screenshot side.                |
| `goyabu`     | `goyabu.io`       | Pulls the Blogger token, then calls Google's `batchexecute` for googlevideo URLs.     |

### Why this is a smaller list than the previous attempt

The earlier revision exposed `AnimePahe`, `HiAnimes`, `AnimeFire`, and
`SuperFlix`. They are removed:

| Removed provider | Why                                                                                                     |
|------------------|---------------------------------------------------------------------------------------------------------|
| `AnimePahe`      | Search and episodes work via FlareSolverr, but `kwik.cx` (the actual stream host) returns Cloudflare-banned for our IP. Even with a real browser FlareSolverr fails the challenge — `Cloudflare has blocked this request`. |
| `HiAnimes`       | The `/ajax/search` and `/ajax/v2/episode/...` JSON endpoints don't exist on `hianimes.se` anymore — every URL now serves the SPA shell. The provider would have to be reverse-engineered against the new in-browser API. |
| `AnimeFire`      | `animefire.plus` is Cloudflare-protected; FlareSolverr can't get a clearance cookie from our IP. |
| `SuperFlix`      | Different surface — `superflixapi.fit` is now a live-action site behind Turnstile; the previous Turnstile-iframe extraction path is dead. |

These are documented (not silently swept under a "skipped" test) so anyone
revisiting from a different network can re-enable them.

## Architecture

```
src/
├── transport/
│   ├── http.ts              # HttpClient — fetch + curl fallback
│   ├── flaresolverr.ts      # Optional Cloudflare bypass proxy
│   ├── dom.ts               # Pluggable DOMParser registry (linkedom in tests)
│   └── hlsUtils.ts          # Rewrite m3u8 chunk URLs through a proxy
├── extractors/
│   ├── BaseExtractor.ts
│   ├── Mp4UploadExtractor.ts        # Direct mp4 URL from www.mp4upload.com
│   ├── BloggerExtractor.ts          # Google batchexecute → googlevideo URLs
│   ├── VidstreamingExtractor.ts     # Legacy Gogo encrypt-ajax flow
│   └── GenericHlsExtractor.ts       # Best-effort m3u8/mp4 from embed pages
├── providers/
│   ├── BaseProvider.ts
│   ├── AllmangaProvider.ts
│   ├── GogoanimeProvider.ts
│   └── GoyabuProvider.ts
├── types/index.ts            # IMediaSearchResult, IContentUnit, ResolvedMediaStream, ...
└── utils/crypto.ts           # AES-CBC + AES-CTR helpers
```

## Getting started

```ts
import { HttpClient, AllmangaProvider } from 'ani-sdk';
import { DOMParser as LinkeDomParser } from 'linkedom';

// linkedom plugs in a DOMParser for Node — required for providers that scrape HTML.
if (typeof globalThis.DOMParser === 'undefined') {
  (globalThis as any).DOMParser = LinkeDomParser;
}

const http = new HttpClient({ timeoutMs: 25000 });
const provider = new AllmangaProvider(http);

const results = await provider.search('Frieren');
const target = results.find((r) => r.title.toLowerCase().includes('beyond journey'));
const units = await provider.fetchContentUnits(target.id, 'sub');
const stream = await provider.resolveStream(units[0].id);

if (stream.type === 'video') {
  console.log('Top stream:', stream.streams[0].sourceUrl);
}
```

`stream.streams` is sorted best-first. Iterate it if the first candidate
returns 4xx — different embed hosts have different reliability windows.

## E2E tests

```bash
# All tests, including live e2e (~60s total against allmanga.to, anineko.to, goyabu.io)
npx vitest run

# Just the e2e suite
npx vitest run tests/e2e
```

Each e2e test:
1. Searches a popular show (`Frieren` for sub/dub providers, `Naruto` for the
   PT-BR provider).
2. Picks a mainline title.
3. Resolves a stream and walks the candidate list with
   `captureStreamScreenshot()`. The helper:
   - probes a URL with a Range GET to distinguish embed pages from direct
     video bytes,
   - scrapes embed HTML for an `.m3u8`/`.mp4` URL when needed,
   - downloads an HLS segment ~5s in and runs ffmpeg locally on it (PNG-wrapped
     segments are stripped), or
   - hands the URL straight to ffmpeg with `-user_agent`/`-referer` for plain
     MP4 sources.
4. Asserts ffmpeg produced a real screenshot (>1KB).

Screenshots land in `scratch/screenshots/screenshot_<provider>.png`.

## Requirements

- Node 20+ (the SDK uses `fetch`, `globalThis.crypto.subtle`, top-level await
  in tests).
- `ffmpeg` on `PATH` for e2e tests.
- `linkedom` is a dev-time dep that registers a Node DOMParser for scraping
  tests.

## License

MIT

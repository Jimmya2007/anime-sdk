# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run build` — `tsc` to `dist/` (ESM, NodeNext). `tests/`, `references/`, `dist/` are excluded.
- `npm test` — `vitest` in watch mode.
- `npm run test:run` — one-shot run of the whole suite (unit + live E2E, ~60s total).
- `npx vitest run tests/e2e` — just the live providers.
- `npx vitest run tests/e2e/allmanga.test.ts` — single E2E file.
- `npx vitest run -t "rewriteManifest"` — single test by name pattern.
- `docker compose up -d flaresolverr` — start the optional Cloudflare-bypass sidecar on `:8191`.

`pnpm` is also configured (`pnpm-lock.yaml`, `pnpm-workspace.yaml`) — either pkg manager works.

Requires Node 20+ and `ffmpeg` on `PATH` (E2E suite shells out to it).

## Architecture

The SDK has three layers, all wired around a single `HttpClient`:

**1. Transport (`src/transport/`)** — site-agnostic plumbing.
- `HttpClient` wraps `fetch` with a **curl fallback** that fires automatically on Node when `fetch` errors out (timeout, TLS quirks, anti-bot rejection). The fallback synthesizes a `Response`-shaped object so callers don't see the difference. It also supports two proxy routing modes (`prepend` puts the proxy in front of `host/path`; `query` passes the URL as a query param) — `requestUrl(url)` is the single chokepoint for that rewrite.
- `DomRegistry` is a global single-parser registry. `BrowserDomParser` works in browsers; in Node, consumers (and the E2E tests' `beforeAll`) must shim `globalThis.DOMParser` via `linkedom` before any provider parses HTML. Providers call `DomRegistry.parse(html)` — they never touch `DOMParser` directly.
- `HlsUtils.rewriteManifest` rewrites every URI line in an `.m3u8` (including `URI="…"` inside `#EXT-X-KEY` / `#EXT-X-MAP`) so chunk fetches go through the same proxy as the manifest fetch.
- `FlareSolverrClient` is **not** wired into `HttpClient` — it's a standalone transport providers can opt into when a site is CF/DDoS-Guard protected. None of the three shipped providers need it today.

**2. Extractors (`src/extractors/`)** — stateless, take only an embed URL and an `HttpClient`, return `IVideoPayload[]` (empty if they can't recover a direct stream). `BaseExtractor` is the contract. They're independently usable — a consumer can hand any embed URL to `BloggerExtractor` without involving a provider.

**3. Providers (`src/providers/`)** — site-specific. `BaseProvider` defines `search` → `fetchContentUnits(mediaId, language?)` → `resolveStream(unitId, language?)`. `ContentLanguage` is `'sub' | 'dub' | 'raw'`; providers that don't support a language fall back to `'sub'`. Each provider composes one or more extractors:
- `AllmangaProvider` — AllAnime GraphQL → AES-CTR-decrypted `tobeparsed` payload → `Mp4UploadExtractor`, with a `clock.json` fallback for wixmp/sharepoint sources. Source URLs are obfuscated with a `--<hex>` scheme XOR'd with `0x38`; see `decodeAllAnimeSource`.
- `GogoanimeProvider` — HTML scrape of `anineko.to`; vibeplayer embed → `master.m3u8` via `GenericHlsExtractor`.
- `GoyabuProvider` — pulls a Blogger token from `playersData`, calls Google `batchexecute` to recover the `googlevideo.com` URL via `BloggerExtractor`.

All public surface is re-exported from `src/index.ts`.

## ESM import convention

`tsconfig.json` uses `module: NodeNext`, so **all relative imports in `src/` must include the `.js` extension** (even though source is `.ts`). New files must follow this — `import { X } from './foo.js'`, never `'./foo'`.

## Tests

- **Unit tests** (`tests/*.test.ts`) cover `HttpClient`, `HlsUtils`, `DomRegistry`, `FlareSolverrClient`, extractor parsing, language inference.
- **E2E tests** (`tests/e2e/*.test.ts`) are intentionally **not mocked**. Each searches a popular title, picks an episode, resolves the stream, and runs it through `captureStreamScreenshot` — which probes URLs with a Range GET (`Content-Type` + MP4 `ftyp` magic) to distinguish embed pages from raw video, fetches an HLS segment ~5s in, strips PNG-wrapped segments, and runs `ffmpeg` to extract a frame. Output lands in `scratch/screenshots/screenshot_<provider>.png` (gitignored). Assertion: the PNG is >1KB. Don't try to make these tests pass by mocking — the whole point is to catch upstream site changes.
- Each E2E test sets `vitest` `timeout: 90000` — these are slow and that's expected.
- `references/` (cloned source from `ani-cli`, `animdl`, `GoAnime`, `mov-cli`) is gitignored prior art for site-scraping logic; not part of the build or tests.

## Provider/extractor additions

When adding a provider:
- Extend `BaseProvider`, set `id` and `supportedTypes`, accept `HttpClient` in the constructor.
- Compose existing extractors where possible; only add a new extractor if the embed format is genuinely novel.
- Re-export from `src/index.ts`.
- Add a live E2E test that resolves a real stream and screenshots it.
- If the site is CF/DDoS-Guard-protected, accept an optional `FlareSolverrClient` and degrade gracefully (throw a clear error) when it's absent.

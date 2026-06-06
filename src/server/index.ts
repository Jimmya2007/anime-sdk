import * as http from 'node:http';
import { Readable } from 'node:stream';
import { BaseProvider } from '../providers/BaseProvider.js';
import { ContentLanguage, IUnitTracks, ResolvedMediaStream, SdkCache } from '../types/index.js';
import { proxifySubtitleUrl } from '../utils/subtitles.js';

export interface ServerOptions {
  providers: BaseProvider[];
  port?: number;
  auth?: { token: string };
  /**
   * Enable the `/proxy` endpoint and automatically rewrite stream `sourceUrl` values
   * to go through it — so browsers can play streams that require custom headers.
   */
  proxy?: boolean;
  /**
   * Optional read/write cache for provider responses. When set, `/search`,
   * `/content`, `/stream`, and `/tracks` results are looked up by a stable
   * key before invoking the provider. See {@link SdkCache} for the contract
   * and the key namespacing used.
   */
  cache?: SdkCache;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Expose-Headers': '*',
};

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    ...CORS,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function err(res: http.ServerResponse, status: number, message: string): void {
  json(res, status, { error: message });
}

/**
 * Rewrite every URI in an HLS manifest so each segment/key/sub-playlist
 * is fetched through the proxy endpoint, preserving the original headers param.
 */
function rewriteHls(manifest: string, baseUrl: string, proxyBase: string, hParam?: string): string {
  const h = hParam ? `&h=${encodeURIComponent(hParam)}` : '';
  const wrap = (uri: string) => {
    try {
      const abs = new URL(uri, baseUrl).href;
      return `${proxyBase}?url=${encodeURIComponent(abs)}${h}`;
    } catch {
      return uri;
    }
  };
  return manifest
    .split(/\r?\n/)
    .map((line) => {
      const t = line.trim();
      if (!t) return line;
      if (t.startsWith('#'))
        return t.replace(/URI=(["'])(.*?)\1/g, (_, q, u) => `URI=${q}${wrap(u)}${q}`);
      return wrap(t);
    })
    .join('\n');
}

/**
 * Rewrite video stream `sourceUrl` fields (and subtitle URLs) to route through
 * the proxy, with any required headers encoded in the `h` query param.
 */
function proxyifyStream(stream: ResolvedMediaStream, proxyBase: string): ResolvedMediaStream {
  if (stream.type === 'manga') {
    const hParam =
      stream.pages.headers && Object.keys(stream.pages.headers).length > 0
        ? Buffer.from(JSON.stringify(stream.pages.headers)).toString('base64')
        : undefined;
    const suffix = hParam ? `&h=${encodeURIComponent(hParam)}` : '';
    return {
      type: 'manga',
      pages: {
        ...stream.pages,
        imageUrls: stream.pages.imageUrls.map(
          (url) => `${proxyBase}?url=${encodeURIComponent(url)}${suffix}`,
        ),
      },
    };
  }

  if (stream.type !== 'video') return stream;
  return {
    type: 'video',
    streams: stream.streams.map((s) => {
      const hParam =
        s.headers && Object.keys(s.headers).length > 0
          ? Buffer.from(JSON.stringify(s.headers)).toString('base64')
          : undefined;
      const suffix = hParam ? `&h=${encodeURIComponent(hParam)}` : '';
      const subtitles = s.subtitles?.map((t) => ({
        ...t,
        url: proxifySubtitleUrl(proxyBase, t),
      }));
      return {
        ...s,
        sourceUrl: `${proxyBase}?url=${encodeURIComponent(s.sourceUrl)}${suffix}`,
        ...(subtitles ? { subtitles } : {}),
      };
    }),
  };
}

/** Wrap the subtitle URLs returned by `fetchUnitTracks` through `/proxy`. */
function proxyifyTracks(tracks: IUnitTracks, proxyBase: string): IUnitTracks {
  return {
    ...tracks,
    subtitles: tracks.subtitles.map((t) => ({ ...t, url: proxifySubtitleUrl(proxyBase, t) })),
  };
}

export function startServer(options: ServerOptions): http.Server {
  const { providers, port = 3000, auth, proxy = false, cache } = options;
  const proxyBase = `http://localhost:${port}/proxy`;

  async function cached<T>(key: string, compute: () => Promise<T>): Promise<T> {
    if (!cache) return compute();
    const hit = await cache.get(key);
    if (hit !== undefined) return hit as T;
    const value = await compute();
    await cache.set(key, value);
    return value;
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost`);
    const q = url.searchParams;

    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS);
      res.end();
      return;
    }

    if (auth) {
      const header = req.headers['authorization'] ?? '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : '';
      if (token !== auth.token) return err(res, 401, 'Unauthorized');
    }

    if (req.method !== 'GET') return err(res, 405, 'Method not allowed');

    const findProvider = (id: string | null): BaseProvider | null =>
      id ? (providers.find((p) => p.id === id) ?? null) : null;

    try {
      // ── Proxy ──────────────────────────────────────────────────────────
      if (url.pathname === '/proxy') {
        if (!proxy)
          return err(res, 404, 'Proxy not enabled — set proxy: true in startServer options');

        const targetUrl = q.get('url');
        if (!targetUrl) return err(res, 400, 'Missing param: url');

        const hParam = q.get('h');
        const upstreamHeaders: Record<string, string> = {
          Accept: '*/*',
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'identity',
        };
        if (hParam) {
          try {
            Object.assign(
              upstreamHeaders,
              JSON.parse(Buffer.from(hParam, 'base64').toString('utf8')),
            );
          } catch {
            /* ignore malformed headers param */
          }
        }
        // Forward Range header for video seeking
        if (req.headers.range) upstreamHeaders['Range'] = req.headers.range;

        // Abort the upstream fetch when the client disconnects to avoid leaking connections
        const abortCtrl = new AbortController();
        req.on('close', () => abortCtrl.abort());

        let upstream: Response;
        try {
          upstream = await fetch(targetUrl, {
            headers: upstreamHeaders,
            redirect: 'follow',
            signal: abortCtrl.signal,
          });
        } catch (fetchErr) {
          const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
          console.error(`Proxy fetch failed for ${targetUrl}: ${msg}`);
          return err(res, 502, `Upstream fetch failed: ${msg}`);
        }

        if (!upstream.ok) {
          const text = await upstream.text().catch(() => 'No body');
          console.error(
            `Proxy upstream error ${upstream.status} for ${targetUrl}: ${text.slice(0, 200)}`,
          );
          return err(
            res,
            upstream.status === 404 ? 404 : 502,
            `Upstream returned ${upstream.status}: ${text.slice(0, 100)}`,
          );
        }

        const ct = upstream.headers.get('content-type') ?? '';

        // Detect HLS by Content-Type, URL extension, or body peek (#EXTM3U)
        const looksLikeHls =
          ct.toLowerCase().includes('mpegurl') || targetUrl.split('?')[0].endsWith('.m3u8');

        if (looksLikeHls) {
          const text = await upstream.text();
          // Also check by body content in case Content-Type is wrong
          if (!text.trim().startsWith('#EXTM3U') && !looksLikeHls) {
            // Not actually an HLS manifest — fall through to stream it
          } else {
            const rewritten = rewriteHls(text, targetUrl, proxyBase, hParam ?? undefined);
            const buf = Buffer.from(rewritten, 'utf8');
            res.writeHead(upstream.status, {
              ...CORS,
              'Content-Type': 'application/vnd.apple.mpegurl',
              'Content-Length': buf.length,
            });
            res.end(buf);
            return;
          }
        }

        // For non-HLS (segments, MP4, etc.) — stream without buffering
        // Some CDNs disguise .ts segments as image/* or text/* — override the type
        const ctOverride = q.get('ct');
        let contentType = ct || 'application/octet-stream';
        if (ctOverride) {
          contentType = ctOverride;
        } else if (
          targetUrl.split('?')[0].toLowerCase().endsWith('.ts') &&
          (ct.startsWith('image/') || (ct.startsWith('text/') && !ct.includes('html')))
        ) {
          contentType = 'video/mp2t';
        }
        // mp4upload and similar CDNs return application/octet-stream for .mp4 files
        if (
          contentType === 'application/octet-stream' &&
          targetUrl.split('?')[0].toLowerCase().endsWith('.mp4')
        ) {
          contentType = 'video/mp4';
        }

        const outHeaders: Record<string, string> = { ...CORS, 'Content-Type': contentType };
        const cl = upstream.headers.get('content-length');
        if (cl) outHeaders['Content-Length'] = cl;
        const cr = upstream.headers.get('content-range');
        if (cr) outHeaders['Content-Range'] = cr;
        const ar = upstream.headers.get('accept-ranges');
        outHeaders['Accept-Ranges'] = ar ?? 'bytes';

        res.writeHead(upstream.status, outHeaders);

        if (upstream.body) {
          const readable = Readable.fromWeb(
            upstream.body as Parameters<typeof Readable.fromWeb>[0],
          );
          readable.on('error', () => {});
          res.on('close', () => readable.destroy());
          readable.pipe(res);
        } else {
          res.end();
        }
        return;
      }

      // ── API ────────────────────────────────────────────────────────────
      // Each handler runs its provider call through the optional `cache`.
      // Keys are namespaced by endpoint + provider so the consumer's cache
      // can apply different TTLs per kind if it wants to.
      if (url.pathname === '/search') {
        const query = q.get('q');
        const provider = findProvider(q.get('provider'));
        if (!query) return err(res, 400, 'Missing param: q');
        if (!provider) return err(res, 400, 'Missing or unknown param: provider');
        const items = await cached(`search:${provider.id}:${query}`, () => provider.search(query));
        return json(res, 200, items);
      }

      if (url.pathname === '/content') {
        const mediaId = q.get('mediaId');
        const provider = findProvider(q.get('provider'));
        if (!mediaId) return err(res, 400, 'Missing param: mediaId');
        if (!provider) return err(res, 400, 'Missing or unknown param: provider');
        // One call returns all episodes; each unit advertises its available
        // translations. Callers pick the language at /stream time.
        const units = await cached(`content:${provider.id}:${mediaId}`, () =>
          provider.fetchContentUnits(mediaId),
        );
        return json(res, 200, units);
      }

      if (url.pathname === '/stream') {
        const unitId = q.get('unitId');
        const provider = findProvider(q.get('provider'));
        const language = q.get('language') as ContentLanguage | null;
        if (!unitId) return err(res, 400, 'Missing param: unitId');
        if (!provider) return err(res, 400, 'Missing or unknown param: provider');
        let stream = await cached(`stream:${provider.id}:${unitId}:${language ?? ''}`, () =>
          provider.resolveStream(unitId, language ?? undefined),
        );
        if (proxy) stream = proxyifyStream(stream, proxyBase);
        return json(res, 200, stream);
      }

      if (url.pathname === '/tracks') {
        const unitId = q.get('unitId');
        const provider = findProvider(q.get('provider'));
        const language = q.get('language') as ContentLanguage | null;
        if (!unitId) return err(res, 400, 'Missing param: unitId');
        if (!provider) return err(res, 400, 'Missing or unknown param: provider');
        // Only the cheap metadata path. Providers without `fetchUnitTracks`
        // return 501 — clients should fall back to /stream's subtitle info
        // rather than pay the resolveStream cost twice.
        if (!provider.fetchUnitTracks) {
          return err(
            res,
            501,
            `Provider "${provider.id}" does not expose track metadata; read subtitles from /stream instead`,
          );
        }
        let tracks = await cached(`tracks:${provider.id}:${unitId}:${language ?? ''}`, () =>
          provider.fetchUnitTracks!(unitId, language ?? undefined),
        );
        if (proxy) tracks = proxyifyTracks(tracks, proxyBase);
        return json(res, 200, tracks);
      }

      return err(res, 404, 'Not found');
    } catch (e) {
      console.log(e);
      return err(res, 500, e instanceof Error ? e.message : String(e));
    }
  });

  server.listen(port, () => console.log(`ani-sdk server listening on http://localhost:${port}`));
  return server;
}

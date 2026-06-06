import * as http from 'node:http';
import { Readable } from 'node:stream';
import { BaseProvider } from '../providers/BaseProvider.js';
import { ContentLanguage, ResolvedMediaStream } from '../types/index.js';

export interface ServerOptions {
  providers: BaseProvider[];
  port?: number;
  auth?: { token: string };
  /**
   * Enable the `/proxy` endpoint and automatically rewrite stream `sourceUrl` values
   * to go through it — so browsers can play streams that require custom headers.
   */
  proxy?: boolean;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
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
 * Rewrite video stream `sourceUrl` fields to route through the proxy,
 * with any required headers encoded in the `h` query param.
 */
function proxyifyStream(stream: ResolvedMediaStream, proxyBase: string): ResolvedMediaStream {
  if (stream.type !== 'video') return stream;
  return {
    type: 'video',
    streams: stream.streams.map((s) => {
      const hParam =
        s.headers && Object.keys(s.headers).length > 0
          ? Buffer.from(JSON.stringify(s.headers)).toString('base64')
          : undefined;
      const suffix = hParam ? `&h=${encodeURIComponent(hParam)}` : '';
      return { ...s, sourceUrl: `${proxyBase}?url=${encodeURIComponent(s.sourceUrl)}${suffix}` };
    }),
  };
}

export function startServer(options: ServerOptions): http.Server {
  const { providers, port = 3000, auth, proxy = false } = options;
  const proxyBase = `http://localhost:${port}/proxy`;

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
        const upstreamHeaders: Record<string, string> = { Accept: '*/*' };
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

        const upstream = await fetch(targetUrl, { headers: upstreamHeaders, redirect: 'follow' });

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
        let contentType = ct || 'application/octet-stream';
        if (ct.startsWith('image/') || (ct.startsWith('text/') && !ct.includes('html'))) {
          contentType = 'video/mp2t';
        }

        const outHeaders: Record<string, string> = { ...CORS, 'Content-Type': contentType };
        const cl = upstream.headers.get('content-length');
        if (cl) outHeaders['Content-Length'] = cl;
        const cr = upstream.headers.get('content-range');
        if (cr) outHeaders['Content-Range'] = cr;

        res.writeHead(upstream.status, outHeaders);

        if (upstream.body) {
          Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]).pipe(res);
        } else {
          res.end();
        }
        return;
      }

      // ── API ────────────────────────────────────────────────────────────
      if (url.pathname === '/search') {
        const query = q.get('q');
        const provider = findProvider(q.get('provider'));
        if (!query) return err(res, 400, 'Missing param: q');
        if (!provider) return err(res, 400, 'Missing or unknown param: provider');
        return json(res, 200, await provider.search(query));
      }

      if (url.pathname === '/content') {
        const mediaId = q.get('mediaId');
        const provider = findProvider(q.get('provider'));
        const language = q.get('language') as ContentLanguage | null;
        if (!mediaId) return err(res, 400, 'Missing param: mediaId');
        if (!provider) return err(res, 400, 'Missing or unknown param: provider');
        return json(res, 200, await provider.fetchContentUnits(mediaId, language ?? undefined));
      }

      if (url.pathname === '/stream') {
        const unitId = q.get('unitId');
        const provider = findProvider(q.get('provider'));
        const language = q.get('language') as ContentLanguage | null;
        if (!unitId) return err(res, 400, 'Missing param: unitId');
        if (!provider) return err(res, 400, 'Missing or unknown param: provider');
        let stream = await provider.resolveStream(unitId, language ?? undefined);
        if (proxy) stream = proxyifyStream(stream, proxyBase);
        return json(res, 200, stream);
      }

      return err(res, 404, 'Not found');
    } catch (e) {
      return err(res, 500, e instanceof Error ? e.message : String(e));
    }
  });

  server.listen(port, () => console.log(`ani-sdk server listening on http://localhost:${port}`));
  return server;
}

import * as http from 'node:http';
import { BaseProvider } from '../providers/BaseProvider.js';
import { ContentLanguage } from '../types/index.js';

export interface ServerOptions {
  providers: BaseProvider[];
  port?: number;
  auth?: { token: string };
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function err(res: http.ServerResponse, status: number, message: string): void {
  json(res, status, { error: message });
}

export function startServer(options: ServerOptions): http.Server {
  const { providers, port = 3000, auth } = options;

  const server = http.createServer(async (req, res) => {
    const baseUrl = `http://localhost`;
    const url = new URL(req.url ?? '/', baseUrl);
    const q = url.searchParams;

    if (auth) {
      const header = req.headers['authorization'] ?? '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : '';
      if (token !== auth.token) {
        return err(res, 401, 'Unauthorized');
      }
    }

    if (req.method !== 'GET') {
      return err(res, 405, 'Method not allowed');
    }

    function findProvider(id: string | null): BaseProvider | null {
      if (!id) return null;
      return providers.find((p) => p.id === id) ?? null;
    }

    try {
      if (url.pathname === '/search') {
        const query = q.get('q');
        const provider = findProvider(q.get('provider'));
        if (!query) return err(res, 400, 'Missing query param: q');
        if (!provider) return err(res, 400, 'Missing or unknown query param: provider');
        const results = await provider.search(query);
        return json(res, 200, results);
      }

      if (url.pathname === '/content') {
        const mediaId = q.get('mediaId');
        const provider = findProvider(q.get('provider'));
        const language = q.get('language') as ContentLanguage | null;
        if (!mediaId) return err(res, 400, 'Missing query param: mediaId');
        if (!provider) return err(res, 400, 'Missing or unknown query param: provider');
        const units = await provider.fetchContentUnits(mediaId, language ?? undefined);
        return json(res, 200, units);
      }

      if (url.pathname === '/stream') {
        const unitId = q.get('unitId');
        const provider = findProvider(q.get('provider'));
        const language = q.get('language') as ContentLanguage | null;
        if (!unitId) return err(res, 400, 'Missing query param: unitId');
        if (!provider) return err(res, 400, 'Missing or unknown query param: provider');
        const stream = await provider.resolveStream(unitId, language ?? undefined);
        return json(res, 200, stream);
      }

      return err(res, 404, 'Not found');
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err(res, 500, message);
    }
  });

  server.listen(port, () => {
    console.log(`ani-sdk server listening on http://localhost:${port}`);
  });

  return server;
}

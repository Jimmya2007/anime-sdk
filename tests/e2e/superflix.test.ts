import { describe, it, expect, beforeAll } from 'vitest';
import { DOMParser as LinkeDomParser } from 'linkedom';
import { HttpClient } from '../../src/transport/http.js';
import { SuperFlixProvider } from '../../src/providers/SuperFlixProvider.js';

beforeAll(() => {
  if (typeof globalThis.DOMParser === 'undefined') {
    globalThis.DOMParser = LinkeDomParser as any;
  }
});

describe('SuperFlix E2E Live Integration Test', () => {
  it('should search, fetch content units, and resolve stream successfully', async () => {
    const http = new HttpClient();
    const provider = new SuperFlixProvider(http);

    const query = 'Naruto';
    console.log(`Searching for "${query}" on SuperFlix...`);
    const searchResults = await provider.search(query);
    expect(searchResults.length).toBeGreaterThan(0);

    const firstResult = searchResults[0];
    console.log(`Found result: ${firstResult.title} (${firstResult.id})`);
    expect(firstResult.providerId).toBe('superflix');

    console.log(`Fetching content units for: ${firstResult.id}`);
    const units = await provider.fetchContentUnits(firstResult.id);
    expect(units.length).toBeGreaterThan(0);

    const firstUnit = units[0];
    console.log(`First content unit: ${firstUnit.title} (${firstUnit.id})`);

    console.log(`Resolving stream for content unit: ${firstUnit.id}`);
    const streamPayload = await provider.resolveStream(firstUnit.id);

    expect(streamPayload.type).toBe('video');
    if (streamPayload.type === 'video') {
      expect(streamPayload.streams.length).toBeGreaterThan(0);
      const stream = streamPayload.streams[0];
      console.log(`Resolved stream URL: ${stream.sourceUrl}`);
      expect(stream.sourceUrl).toBeTruthy();

      console.log(`Performing verification request to: ${stream.sourceUrl}`);
      const headers = stream.headers || {};

      // Try HEAD request first, fallback to GET (with bytes range to avoid downloading the whole file)
      let streamRes: Response;
      try {
        streamRes = await fetch(stream.sourceUrl, {
          method: 'HEAD',
          headers,
        });
        if (streamRes.status !== 200) {
          throw new Error('HEAD failed');
        }
      } catch (err) {
        console.log('HEAD request failed or returned non-200. Retrying with range GET...');
        streamRes = await fetch(stream.sourceUrl, {
          method: 'GET',
          headers: {
            ...headers,
            Range: 'bytes=0-1024',
          },
        });
      }

      console.log(`Stream server responded with status: ${streamRes.status}`);
      expect([200, 206]).toContain(streamRes.status);
    }
  }, 90000); // 90-second timeout for live scraper + browser launch
});

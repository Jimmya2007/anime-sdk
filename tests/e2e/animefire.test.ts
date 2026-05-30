/**
 * E2E integration tests for AnimefireProvider.
 *
 * These tests require FlareSolverr to be running at http://localhost:8191.
 * If FlareSolverr is not available or Cloudflare blocks the request, the test fails.
 *
 * To run: docker compose up -d flaresolverr && npx vitest run tests/e2e/animefire.test.ts
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { DOMParser as LinkeDomParser } from 'linkedom';
import { HttpClient } from '../../src/transport/http.js';
import { FlareSolverrClient } from '../../src/transport/flaresolverr.js';
import { AnimefireProvider } from '../../src/providers/AnimefireProvider.js';
import { captureStreamScreenshot } from './screenshotHelper.js';

beforeAll(() => {
  if (typeof globalThis.DOMParser === 'undefined') {
    globalThis.DOMParser = LinkeDomParser as any;
  }
});

describe('AnimeFire E2E Live Integration Test', () => {
  let flare: FlareSolverrClient;
  let provider: AnimefireProvider;

  beforeAll(async () => {
    flare = new FlareSolverrClient({ url: 'http://localhost:8191', timeoutMs: 60000 });
    const isAvailable = await flare.isAvailable();
    expect(isAvailable, 'FlareSolverr must be running at localhost:8191').toBe(true);

    const http = new HttpClient();
    provider = new AnimefireProvider(http, { flaresolverr: flare });
  }, 10000);

  it('should search, fetch content units, and resolve stream successfully', async () => {
    const query = 'Frieren';
    console.log(`Searching for "${query}" on AnimeFire...`);
    const searchResults = await provider.search(query);
    expect(searchResults.length).toBeGreaterThan(0);

    const firstResult = searchResults[0];
    console.log(`Found result: ${firstResult.title} (${firstResult.id})`);
    expect(firstResult.providerId).toBe('animefire');

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

      const streamRes = await fetch(stream.sourceUrl, {
        method: 'GET',
        headers: {
          ...headers,
          Range: 'bytes=0-1024',
        },
      });

      console.log(`Stream server responded with status: ${streamRes.status}`);
      expect([200, 206]).toContain(streamRes.status);

      // Capture screenshot using ffmpeg — throws on failure, causing the test to fail
      await captureStreamScreenshot('animefire', stream.sourceUrl, headers);
    }
  }, 90000); // 90-second timeout
});

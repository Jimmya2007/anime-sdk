/**
 * E2E integration tests for SuperFlixProvider.
 *
 * These tests require FlareSolverr to be running at http://localhost:8191.
 * If FlareSolverr is not available or Cloudflare blocks the request, the test fails.
 *
 * To run: docker compose up -d flaresolverr && npx vitest run tests/e2e/superflix.test.ts
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { DOMParser as LinkeDomParser } from 'linkedom';
import { HttpClient } from '../../src/transport/http.js';
import { FlareSolverrClient } from '../../src/transport/flaresolverr.js';
import { SuperFlixProvider } from '../../src/providers/SuperFlixProvider.js';
import { captureStreamScreenshot } from './screenshotHelper.js';

beforeAll(() => {
  if (typeof globalThis.DOMParser === 'undefined') {
    globalThis.DOMParser = LinkeDomParser as any;
  }
});

describe('SuperFlix E2E Live Integration Test', () => {
  let flare: FlareSolverrClient;
  let provider: SuperFlixProvider;

  beforeAll(async () => {
    flare = new FlareSolverrClient({ url: 'http://localhost:8191', timeoutMs: 60000 });
    const isAvailable = await flare.isAvailable();
    expect(isAvailable, 'FlareSolverr must be running at localhost:8191').toBe(true);

    const http = new HttpClient();
    provider = new SuperFlixProvider(http, { flaresolverr: flare });
  }, 10000);

  it('should search successfully', async () => {
    const query = 'Naruto';
    console.log(`Searching for "${query}" on SuperFlix...`);
    const searchResults = await provider.search(query);
    expect(searchResults.length).toBeGreaterThan(0);

    const firstResult = searchResults[0];
    console.log(`Found result: ${firstResult.title} (${firstResult.id})`);
    expect(firstResult.providerId).toBe('superflix');
  }, 30000);

  it('should fetch content units successfully', async () => {
    const query = 'Naruto';
    const searchResults = await provider.search(query);
    expect(searchResults.length).toBeGreaterThan(0);

    const firstResult = searchResults[0];
    console.log(`Fetching content units for: ${firstResult.id}`);
    const units = await provider.fetchContentUnits(firstResult.id);
    expect(units.length).toBeGreaterThan(0);

    const firstUnit = units[0];
    console.log(`First content unit: ${firstUnit.title} (${firstUnit.id})`);
  }, 30000);

  it('should resolve stream successfully (requires FlareSolverr)', async () => {
    const query = 'Naruto';
    const searchResults = await provider.search(query);
    expect(searchResults.length).toBeGreaterThan(0);

    const firstResult = searchResults[0];
    const units = await provider.fetchContentUnits(firstResult.id);
    expect(units.length).toBeGreaterThan(0);

    const firstUnit = units[0];
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

      // Capture screenshot using ffmpeg — throws on failure, causing the test to fail
      await captureStreamScreenshot('superflix', stream.sourceUrl, headers);
    }
  }, 120000); // 120-second timeout for live scraper + browser solve
});

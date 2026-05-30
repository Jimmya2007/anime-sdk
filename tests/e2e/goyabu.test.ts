/**
 * E2E integration tests for GoyabuProvider.
 *
 * These tests verify the Goyabu site is reachable. If the site is down, the test fails.
 *
 * To run: npx vitest run tests/e2e/goyabu.test.ts
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { DOMParser as LinkeDomParser } from 'linkedom';
import { HttpClient } from '../../src/transport/http.js';
import { GoyabuProvider } from '../../src/providers/GoyabuProvider.js';
import { captureStreamScreenshot } from './screenshotHelper.js';

beforeAll(() => {
  if (typeof globalThis.DOMParser === 'undefined') {
    globalThis.DOMParser = LinkeDomParser as any;
  }
});

describe('Goyabu E2E Live Integration Test', () => {
  let provider: GoyabuProvider;

  beforeAll(async () => {
    const http = new HttpClient();
    provider = new GoyabuProvider(http);

    // Verify site is reachable — fail hard if it's not
    const res = await fetch('https://goyabu.io', {
      method: 'HEAD',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      signal: AbortSignal.timeout(8000)
    });
    expect(res.status, `goyabu.io returned ${res.status} — site must be reachable`).toBeLessThan(500);
  }, 15000);

  it('should search, fetch content units, and resolve stream successfully', async () => {
    const query = 'Naruto';
    console.log(`Searching for "${query}" on Goyabu...`);
    const searchResults = await provider.search(query);
    expect(searchResults.length).toBeGreaterThan(0);

    const firstResult = searchResults[0];
    console.log(`Found result: ${firstResult.title} (${firstResult.id})`);
    expect(firstResult.providerId).toBe('goyabu');

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
      await captureStreamScreenshot('goyabu', stream.sourceUrl, headers);
    }
  }, 45000); // 45-second timeout
});

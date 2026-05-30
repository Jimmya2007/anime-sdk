import { describe, it, expect, beforeAll } from 'vitest';
import { DOMParser as LinkeDomParser } from 'linkedom';
import { HttpClient } from '../../src/transport/http.js';
import { GogoanimeProvider } from '../../src/providers/GogoanimeProvider.js';
import { captureStreamScreenshot } from './screenshotHelper.js';

beforeAll(() => {
  if (typeof globalThis.DOMParser === 'undefined') {
    globalThis.DOMParser = LinkeDomParser as any;
  }
});

describe('GogoAnime E2E Live Integration Test', () => {
  it('should search, fetch content units, and resolve stream successfully', async () => {
    const http = new HttpClient();
    const provider = new GogoanimeProvider(http);

    const query = 'Frieren';
    console.log(`Searching for "${query}" on GogoAnime...`);
    const searchResults = await provider.search(query);
    expect(searchResults.length).toBeGreaterThan(0);

    const firstResult = searchResults[0];
    console.log(`Found result: ${firstResult.title} (${firstResult.id})`);
    expect(firstResult.providerId).toBe('gogoanime');

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

      // Capture screenshot using ffmpeg
      await captureStreamScreenshot('gogoanime', stream.sourceUrl, headers);
    }
  }, 45000); // 45-second timeout
});

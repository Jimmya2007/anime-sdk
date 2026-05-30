/**
 * E2E integration tests for HiAnimesProvider.
 *
 * These tests require FlareSolverr to be running at http://localhost:8191.
 * If FlareSolverr is not available or Cloudflare blocks the request, the test fails.
 *
 * To run: docker compose up -d flaresolverr && npx vitest run tests/e2e/hianimes.test.ts
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { DOMParser as LinkedDomParser } from 'linkedom';
import { HttpClient } from '../../src/transport/http.js';
import { FlareSolverrClient } from '../../src/transport/flaresolverr.js';
import { HiAnimesProvider } from '../../src/providers/HiAnimesProvider.js';
import { captureStreamScreenshot } from './screenshotHelper.js';

beforeAll(() => {
  if (typeof globalThis.DOMParser === 'undefined') {
    (globalThis as any).DOMParser = LinkedDomParser;
  }
});

describe('HiAnimes E2E (requires FlareSolverr)', () => {
  let flare: FlareSolverrClient;
  let provider: HiAnimesProvider;

  beforeAll(async () => {
    flare = new FlareSolverrClient({ url: 'http://localhost:8191', timeoutMs: 60000 });
    const isAvailable = await flare.isAvailable();
    expect(isAvailable, 'FlareSolverr must be running at localhost:8191').toBe(true);

    const http = new HttpClient();
    provider = new HiAnimesProvider(http, { flaresolverr: flare });
  }, 10000);

  it('should search for anime', async () => {
    const results = await provider.search('naruto');
    console.log(`HiAnimes search returned ${results.length} results`);
    expect(results.length).toBeGreaterThan(0);

    const first = results[0];
    expect(first.providerId).toBe('hianimes');
    expect(first.title).toBeTruthy();
    expect(first.id).toBeTruthy();
    console.log(`  First: "${first.title}" (${first.id})`);
    console.log(`  Available languages: ${first.availableLanguages?.join(', ')}`);
  }, 60000);

  it('should fetch episode list', async () => {
    const results = await provider.search('one piece');
    expect(results.length).toBeGreaterThan(0);

    const anime = results[0];
    console.log(`Fetching episodes for: ${anime.title} (${anime.id})`);
    const units = await provider.fetchContentUnits(anime.id, 'sub');
    console.log(`  Found ${units.length} episodes`);
    expect(units.length).toBeGreaterThan(0);

    const ep = units[0];
    expect(ep.language).toBe('sub');
    expect(ep.number).toBeGreaterThan(0);
    // ID should embed language
    expect(ep.id).toContain('/sub');
  }, 90000);

  it('should resolve a stream URL', async () => {
    const results = await provider.search('attack on titan');
    expect(results.length).toBeGreaterThan(0);

    const anime = results[0];
    const units = await provider.fetchContentUnits(anime.id, 'sub');
    expect(units.length).toBeGreaterThan(0);

    const ep1 = units[0];
    console.log(`Resolving stream: ${ep1.title} (${ep1.id})`);
    const stream = await provider.resolveStream(ep1.id);

    expect(stream.type).toBe('video');
    if (stream.type === 'video') {
      expect(stream.streams.length).toBeGreaterThan(0);
      const s = stream.streams[0];
      console.log(`  Stream URL: ${s.sourceUrl}`);
      expect(s.sourceUrl).toMatch(/https?:\/\/.+/);

      // Capture screenshot using ffmpeg — throws on failure, causing the test to fail
      await captureStreamScreenshot('hianimes', s.sourceUrl, s.headers || {});
    }
  }, 120000);
});

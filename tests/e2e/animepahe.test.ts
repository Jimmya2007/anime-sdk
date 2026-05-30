/**
 * E2E integration tests for AnimePaheProvider.
 *
 * These tests require FlareSolverr to be running at http://localhost:8191.
 * If FlareSolverr is not available or Cloudflare blocks the request, the test fails.
 *
 * To run: docker compose up -d flaresolverr && npx vitest run tests/e2e/animepahe.test.ts
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { DOMParser as LinkedDomParser } from 'linkedom';
import { HttpClient } from '../../src/transport/http.js';
import { FlareSolverrClient } from '../../src/transport/flaresolverr.js';
import { AnimePaheProvider } from '../../src/providers/AnimePaheProvider.js';
import { captureStreamScreenshot } from './screenshotHelper.js';

beforeAll(() => {
  if (typeof globalThis.DOMParser === 'undefined') {
    (globalThis as any).DOMParser = LinkedDomParser;
  }
});

describe('AnimePahe E2E (requires FlareSolverr)', () => {
  let flare: FlareSolverrClient;
  let provider: AnimePaheProvider;

  beforeAll(async () => {
    flare = new FlareSolverrClient({ url: 'http://localhost:8191', timeoutMs: 60000 });
    const isAvailable = await flare.isAvailable();
    expect(isAvailable, 'FlareSolverr must be running at localhost:8191').toBe(true);

    const http = new HttpClient();
    provider = new AnimePaheProvider(http, { flaresolverr: flare });
  }, 10000);

  it('should search for anime', async () => {
    const results = await provider.search('frieren');
    console.log(`AnimePahe search returned ${results.length} results`);
    expect(results.length).toBeGreaterThan(0);

    const first = results[0];
    expect(first.providerId).toBe('animepahe');
    expect(first.title).toBeTruthy();
    expect(first.id).toBeTruthy();
    console.log(`  First result: "${first.title}" (${first.id})`);
    console.log(`  Available languages: ${first.availableLanguages?.join(', ')}`);
  }, 60000);

  it('should fetch episode list with sub/dub filtering', async () => {
    const results = await provider.search('frieren');
    expect(results.length).toBeGreaterThan(0);

    const anime = results[0];
    console.log(`Fetching episodes (sub) for: ${anime.title}`);
    const subUnits = await provider.fetchContentUnits(anime.id, 'sub');
    console.log(`  Sub episodes: ${subUnits.length}`);
    expect(subUnits.length).toBeGreaterThan(0);
    expect(subUnits[0].language).toBe('sub');

    // Each unit ID should encode: {animeSession}/{episodeSession}/sub
    const idParts = subUnits[0].id.split('/');
    expect(idParts).toHaveLength(3);
    expect(idParts[2]).toBe('sub');
  }, 120000);

  it('should resolve a stream URL for episode 1', async () => {
    const results = await provider.search('frieren');
    expect(results.length).toBeGreaterThan(0);

    const anime = results[0];
    const units = await provider.fetchContentUnits(anime.id, 'sub');
    expect(units.length).toBeGreaterThan(0);

    const ep1 = units[0];
    console.log(`Resolving stream for: ${ep1.title} (${ep1.id})`);
    const stream = await provider.resolveStream(ep1.id);

    expect(stream.type).toBe('video');
    if (stream.type === 'video') {
      expect(stream.streams.length).toBeGreaterThan(0);
      const s = stream.streams[0];
      console.log(`  Stream URL: ${s.sourceUrl}`);
      expect(s.sourceUrl).toMatch(/https?:\/\/.+/);
      expect(s.language).toBe('sub');

      // Capture screenshot using ffmpeg — throws on failure, causing the test to fail
      await captureStreamScreenshot('animepahe', s.sourceUrl, s.headers || {});
    }
  }, 120000);
});

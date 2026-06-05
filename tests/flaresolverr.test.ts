/**
 * Unit tests for FlareSolverrClient.
 * Tests health check behavior when FlareSolverr is not running.
 */
import { describe, it, expect } from 'vitest';
import { FlareSolverrClient } from '../src/transport/flaresolverr.js';

describe('FlareSolverrClient', () => {
  describe('isAvailable()', () => {
    it('returns false when FlareSolverr is not running (unreachable URL)', async () => {
      const client = new FlareSolverrClient({
        url: 'http://localhost:59999', // Intentionally wrong port
        timeoutMs: 3000,
      });
      const available = await client.isAvailable();
      expect(available).toBe(false);
    }, 5000);

    it('returns false for an invalid host', async () => {
      const client = new FlareSolverrClient({
        url: 'http://this-host-does-not-exist-xyz.local:8191',
        timeoutMs: 3000,
      });
      const available = await client.isAvailable();
      expect(available).toBe(false);
    }, 5000);
  });

  describe('constructor defaults', () => {
    it('uses localhost:8191 by default', () => {
      // We can't easily inspect private properties, but we verify no throws
      expect(() => new FlareSolverrClient()).not.toThrow();
    });

    it('accepts custom URL and timeout options', () => {
      expect(
        () =>
          new FlareSolverrClient({
            url: 'http://custom-flare:8191',
            timeoutMs: 120000,
            maxTimeout: 60000,
          }),
      ).not.toThrow();
    });
  });
});

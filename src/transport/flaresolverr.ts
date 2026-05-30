/**
 * FlareSolverrClient — Optional Cloudflare bypass via FlareSolverr.
 *
 * FlareSolverr is a proxy server to bypass Cloudflare and DDoS-Guard protection.
 * Run it as a Docker container:
 *
 *   docker run -d --name=flaresolverr -p 8191:8191 \
 *     -e LOG_LEVEL=info \
 *     ghcr.io/flaresolverr/flaresolverr:latest
 *
 * Then pass the FlareSolverrClient instance to providers that require bypass.
 * Providers will gracefully throw if no FlareSolverr instance is available.
 *
 * @example
 * ```ts
 * const flare = new FlareSolverrClient({ url: 'http://localhost:8191' });
 * if (await flare.isAvailable()) {
 *   const pahe = new AnimePaheProvider(http, { flaresolverr: flare });
 *   const results = await pahe.search('naruto');
 * }
 * ```
 */
export interface FlareSolverrOptions {
  /** URL to the FlareSolverr instance. Defaults to http://localhost:8191 */
  url?: string;
  /** Request timeout in milliseconds. Defaults to 60000 (60s) */
  timeoutMs?: number;
  /** Max wait time FlareSolverr should spend on the challenge. Defaults to 30000ms */
  maxTimeout?: number;
}

export interface FlareSolverrResponse {
  /** HTTP status code of the final response */
  status: number;
  /** Response body text */
  text(): string;
  /** Parse response as JSON */
  json(): any;
  /** Response headers */
  headers: Record<string, string>;
  /** Final URL after redirects */
  url: string;
}

interface FlareSolverrResult {
  status: 'ok' | 'error';
  message: string;
  solution?: {
    url: string;
    status: number;
    headers: Record<string, string>;
    response: string;
    cookies: Array<{ name: string; value: string; domain?: string; path?: string }>;
    userAgent: string;
  };
  startTimestamp: number;
  endTimestamp: number;
  version: string;
}

export class FlareSolverrClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxTimeout: number;

  constructor(options: FlareSolverrOptions = {}) {
    this.baseUrl = (options.url ?? 'http://localhost:8191').replace(/\/$/, '');
    this.timeoutMs = options.timeoutMs ?? 60000;
    this.maxTimeout = options.maxTimeout ?? 30000;
  }

  /**
   * Check if the FlareSolverr instance is reachable.
   * Returns false gracefully if the service is not running.
   */
  async isAvailable(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);

      const res = await fetch(`${this.baseUrl}/`, {
        method: 'GET',
        signal: controller.signal,
      });
      clearTimeout(timer);

      return res.ok || res.status === 405;
    } catch {
      return false;
    }
  }

  /**
   * Perform a GET request through FlareSolverr, bypassing Cloudflare/DDoS-Guard.
   */
  async get(
    url: string,
    options: {
      headers?: Record<string, string>;
      cookies?: Array<{ name: string; value: string; domain?: string }>;
    } = {}
  ): Promise<FlareSolverrResponse> {
    return this._solve('request.get', url, undefined, options);
  }

  /**
   * Perform a POST request through FlareSolverr, bypassing Cloudflare/DDoS-Guard.
   */
  async post(
    url: string,
    postData: string | Record<string, string>,
    options: {
      headers?: Record<string, string>;
      cookies?: Array<{ name: string; value: string; domain?: string }>;
    } = {}
  ): Promise<FlareSolverrResponse> {
    const postBody =
      typeof postData === 'string'
        ? postData
        : new URLSearchParams(postData).toString();

    return this._solve('request.post', url, postBody, options);
  }

  private async _solve(
    cmd: 'request.get' | 'request.post',
    url: string,
    postData?: string,
    options: {
      headers?: Record<string, string>;
      cookies?: Array<{ name: string; value: string; domain?: string }>;
    } = {}
  ): Promise<FlareSolverrResponse> {
    const body: Record<string, any> = {
      cmd,
      url,
      maxTimeout: this.maxTimeout,
    };

    if (postData !== undefined) {
      body.postData = postData;
    }

    if (options.cookies && options.cookies.length > 0) {
      body.cookies = options.cookies;
    }

    if (options.headers && Object.keys(options.headers).length > 0) {
      body.headers = options.headers;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let rawResponse: Response;
    try {
      rawResponse = await fetch(`${this.baseUrl}/v1`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!rawResponse.ok) {
      const errText = await rawResponse.text().catch(() => '');
      throw new Error(
        `FlareSolverr API error: HTTP ${rawResponse.status}${errText ? ` — ${errText.slice(0, 200)}` : ''}`
      );
    }

    const result: FlareSolverrResult = await rawResponse.json();

    if (result.status !== 'ok' || !result.solution) {
      throw new Error(`FlareSolverr failed to solve challenge: ${result.message}`);
    }

    const sol = result.solution;
    const responseText = sol.response;

    return {
      status: sol.status,
      url: sol.url,
      headers: sol.headers,
      text: () => responseText,
      json: () => {
        try {
          let trimmed = responseText.trim();
          if (trimmed.startsWith('<')) {
            const preMatch = trimmed.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
            if (preMatch) {
              trimmed = preMatch[1]
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .replace(/&#039;/g, "'");
            }
          }
          return JSON.parse(trimmed);
        } catch (e) {
          throw new Error(`FlareSolverrResponse.json(): Body is not valid JSON: ${(e as Error).message}`);
        }
      },
    };
  }
}

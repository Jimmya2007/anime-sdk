export interface HttpClientConfig {
  proxyUrl?: string;
  proxyType?: 'prepend' | 'query';
  proxyQueryParam?: string;
  defaultHeaders?: Record<string, string>;
  timeoutMs?: number;
}

export class HttpClient {
  private proxyUrl?: string;
  private proxyType: 'prepend' | 'query';
  private proxyQueryParam: string;
  private defaultHeaders: Record<string, string>;
  private timeoutMs: number;

  constructor(config: HttpClientConfig = {}) {
    this.proxyUrl = config.proxyUrl;
    this.proxyType = config.proxyType || 'prepend';
    this.proxyQueryParam = config.proxyQueryParam || 'url';
    this.defaultHeaders = config.defaultHeaders || {};
    this.timeoutMs = config.timeoutMs || 10000;
  }

  public getProxyUrl(): string | undefined {
    return this.proxyUrl;
  }

  public getProxyType(): 'prepend' | 'query' {
    return this.proxyType;
  }

  public getProxyQueryParam(): string {
    return this.proxyQueryParam;
  }

  public getDefaultHeaders(): Record<string, string> {
    return this.defaultHeaders;
  }

  public requestUrl(url: string): string {
    if (!this.proxyUrl) return url;
    if (this.proxyType === 'prepend') {
      const base = this.proxyUrl.endsWith('/') ? this.proxyUrl : `${this.proxyUrl}/`;
      // Strip target protocol if the prepend proxy expects path prepending
      // e.g. proxy.com/target.com/path
      const target = url.replace(/^(https?:\/\/)/, '');
      return `${base}${target}`;
    } else {
      const separator = this.proxyUrl.includes('?') ? '&' : '?';
      return `${this.proxyUrl}${separator}${this.proxyQueryParam}=${encodeURIComponent(url)}`;
    }
  }

  private cookieFile?: string;

  public async request(url: string, options: RequestInit = {}): Promise<Response> {
    const targetUrl = this.requestUrl(url);
    const headers: Record<string, string> = { ...this.defaultHeaders };
    if (options.headers) {
      if (options.headers instanceof Headers) {
        options.headers.forEach((value, key) => {
          headers[key] = value;
        });
      } else if (Array.isArray(options.headers)) {
        for (const [key, value] of options.headers) {
          headers[key] = value;
        }
      } else {
        Object.assign(headers, options.headers);
      }
    }

    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(targetUrl, { ...options, headers, signal: controller.signal });
      clearTimeout(id);
      return res;
    } catch (err: any) {
      clearTimeout(id);

      // If the user explicitly aborted the request, propagate the error immediately
      if (options.signal?.aborted || (err.name === 'AbortError' && options.signal)) {
        throw err;
      }

      // If we are in Node.js and the request failed or timed out, try falling back to curl
      if (typeof process !== 'undefined' && process.versions?.node) {
        try {
          const cp = await import('child_process');
          const execSync = cp.execSync;

          if (!this.cookieFile) {
            try {
              const os = await import('os');
              const path = await import('path');
              this.cookieFile = path.join(
                os.tmpdir(),
                `ani-sdk-cookie-${Math.random().toString(36).substring(2)}.txt`,
              );
            } catch (e) {
              this.cookieFile = `/tmp/ani-sdk-cookie-${Math.random().toString(36).substring(2)}.txt`;
            }
          }

          const method = options.method || 'GET';
          let headerArgs = '';
          for (const [key, val] of Object.entries(headers)) {
            headerArgs += ` -H ${JSON.stringify(`${key}: ${val}`)}`;
          }

          if (options.body instanceof URLSearchParams) {
            if (!headers['Content-Type']) {
              headers['Content-Type'] = 'application/x-www-form-urlencoded;charset=UTF-8';
            }
          }

          let bodyArg = '';
          if (options.body) {
            let bodyStr = '';
            if (typeof options.body === 'string') {
              bodyStr = options.body;
            } else if (options.body instanceof URLSearchParams) {
              bodyStr = options.body.toString();
            } else {
              bodyStr = JSON.stringify(options.body);
            }
            bodyArg = ` -d ${JSON.stringify(bodyStr)}`;
          }

          let methodArg = '';
          if (method !== 'GET' && method !== 'POST') {
            methodArg = ` -X ${method}`;
          }

          const cookieArg = ` -c ${JSON.stringify(this.cookieFile)} -b ${JSON.stringify(this.cookieFile)}`;

          // Use -i to include headers, -L to follow redirects, -s for silent, --max-time to prevent hangs
          const curlCmd = `curl -sL --max-time 10${methodArg}${headerArgs}${bodyArg}${cookieArg} -i ${JSON.stringify(targetUrl)}`;
          const output = execSync(curlCmd, { maxBuffer: 10 * 1024 * 1024 });
          const outputStr = output.toString('binary');

          const parts = outputStr.split('\r\n\r\n');
          // Find the last HTTP header section
          let headerSection = '';
          let body = '';
          for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            if (part.startsWith('HTTP/')) {
              headerSection = part;
              body = parts.slice(i + 1).join('\r\n\r\n');
            }
          }

          const headerLines = headerSection.split('\r\n');
          const statusLine = headerLines[0];
          const statusMatch = statusLine.match(/HTTP\/\d+(\.\d+)?\s+(\d+)/);
          const status = statusMatch ? parseInt(statusMatch[2], 10) : 200;

          const responseHeaders = new Headers();
          for (let i = 1; i < headerLines.length; i++) {
            const line = headerLines[i];
            const colonIdx = line.indexOf(':');
            if (colonIdx !== -1) {
              const key = line.substring(0, colonIdx).trim();
              const val = line.substring(colonIdx + 1).trim();
              responseHeaders.append(key, val);
            }
          }

          let finalUrl = targetUrl;
          for (const part of parts) {
            const lines = part.split('\r\n');
            if (lines[0].startsWith('HTTP/')) {
              for (const line of lines) {
                const colonIdx = line.indexOf(':');
                if (colonIdx !== -1) {
                  const key = line.substring(0, colonIdx).trim().toLowerCase();
                  const val = line.substring(colonIdx + 1).trim();
                  if (key === 'location') {
                    try {
                      finalUrl = val.startsWith('http') ? val : new URL(val, finalUrl).toString();
                    } catch (e) {
                      // fallback
                    }
                  }
                }
              }
            }
          }

          return {
            status,
            statusText: 'OK',
            ok: status >= 200 && status < 300,
            headers: responseHeaders,
            url: finalUrl,
            text: async () => body,
            json: async () => JSON.parse(body),
            arrayBuffer: async () => {
              const buf = Buffer.from(body, 'binary');
              return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
            },
          } as unknown as Response;
        } catch (curlErr: any) {
          throw err;
        }
      }
      throw err;
    }
  }

  public async get(url: string, options: RequestInit = {}): Promise<Response> {
    return this.request(url, { ...options, method: 'GET' });
  }

  public async post(url: string, body?: any, options: RequestInit = {}): Promise<Response> {
    const headers: Record<string, string> = {};
    if (options.headers) {
      if (options.headers instanceof Headers) {
        options.headers.forEach((value, key) => {
          headers[key] = value;
        });
      } else if (Array.isArray(options.headers)) {
        for (const [key, value] of options.headers) {
          headers[key] = value;
        }
      } else {
        Object.assign(headers, options.headers);
      }
    }
    let finalBody = body;
    if (
      body &&
      typeof body === 'object' &&
      !(body instanceof FormData) &&
      !(body instanceof URLSearchParams)
    ) {
      if (!headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
      }
      finalBody = JSON.stringify(body);
    }
    return this.request(url, { ...options, method: 'POST', headers, body: finalBody });
  }

  public setCookie(name: string, value: string): void {
    const existingCookie = this.defaultHeaders['Cookie'] || '';
    const cookies = existingCookie ? existingCookie.split(';').map((c) => c.trim()) : [];
    const newCookies = cookies.filter((c) => !c.startsWith(`${name}=`));
    newCookies.push(`${name}=${value}`);
    this.defaultHeaders['Cookie'] = newCookies.join('; ');
  }

  public setUserAgent(userAgent: string): void {
    this.defaultHeaders['User-Agent'] = userAgent;
  }
}

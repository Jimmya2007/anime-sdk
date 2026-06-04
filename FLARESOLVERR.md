# FlareSolverr

`FlareSolverrClient` is a thin wrapper around
[FlareSolverr](https://github.com/FlareSolverr/FlareSolverr) — a Docker
container that drives a headless Chrome to solve Cloudflare and DDoS-Guard
challenges. The SDK exposes it as an opt-in transport.

> **None of the bundled providers currently use FlareSolverr.** The CF-gated
> providers (AnimePahe, HiAnimes, AnimeFire, SuperFlix) were removed because
> they're broken from this network even with FlareSolverr in front — see
> `README.md` for the breakdown. The client is kept because the wrapper is
> small and useful for writing your own provider against a CF-protected site.

## Running it

`docker-compose.yml` in the repo root already has a service defined:

```bash
docker compose up -d flaresolverr
# health check
curl -s http://localhost:8191/ | jq .
```

Or run the container directly:

```bash
docker run -d --name=flaresolverr \
  -p 8191:8191 \
  -e LOG_LEVEL=info \
  --restart unless-stopped \
  ghcr.io/flaresolverr/flaresolverr:latest
```

## Using the client

```ts
import { FlareSolverrClient, HttpClient } from 'ani-sdk';

const flare = new FlareSolverrClient({
  url: 'http://localhost:8191',
});

if (!(await flare.isAvailable())) {
  throw new Error('FlareSolverr is not running');
}

// GET — the response carries cookies, the resolved URL, and the body.
const res = await flare.get('https://example-protected.site/api/search?q=naruto');
console.log(res.status, res.url);
console.log(res.text().slice(0, 200));

// POST — pass form data as a string or Record<string, string>.
const post = await flare.post(
  'https://example-protected.site/api/login',
  { user: 'demo', pass: 'demo' },
  { headers: { Referer: 'https://example-protected.site/' } },
);
```

`res.json()` is best-effort — if the protected site returns JSON wrapped in
HTML (Cloudflare's default chrome around an API response), the wrapper
strips the `<pre>` tag and HTML-decodes the body before parsing.

## Options

| Option       | Default                  | Notes                                                                                                       |
|--------------|--------------------------|-------------------------------------------------------------------------------------------------------------|
| `url`        | `http://localhost:8191`  | The FlareSolverr base URL.                                                                                  |
| `timeoutMs`  | `120000`                 | Outer timeout — how long this client waits on the FlareSolverr API itself before aborting.                  |
| `maxTimeout` | `90000`                  | How long FlareSolverr is allowed to spend solving the challenge internally. Default was bumped from 30s — first-attempt DDoS-Guard solves regularly run 45-60s. |

## Reusing cookies

The `solution.cookies` array on the response is the set of cookies the
headless browser ended up with (including `cf_clearance`, `SERVERID`, the
target site's session cookies, etc.). Pass them into the next call via
`options.cookies` to skip the challenge:

```ts
const first = await flare.get('https://cf-site.example/');
const cookies = (first as any).solution?.cookies ?? [];

const second = await flare.get('https://cf-site.example/api/list', {
  cookies,
});
```

For sites that bind clearance to a single session, you'll generally want to
keep a `FlareSolverrClient` and the cookies it accumulates alive for the life
of a logical "session" rather than constructing a new one per request.

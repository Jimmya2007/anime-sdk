# FlareSolverr — Optional Cloudflare Bypass

Some anime providers (AnimePahe, HiAnimes) are protected by Cloudflare or DDoS-Guard.
The SDK supports bypassing these protections via [FlareSolverr](https://github.com/FlareSolverr/FlareSolverr).

## Quick Start with Docker

```bash
docker run -d \
  --name=flaresolverr \
  -p 8191:8191 \
  -e LOG_LEVEL=info \
  --restart unless-stopped \
  ghcr.io/flaresolverr/flaresolverr:latest
```

## Using Docker Compose

```bash
docker compose up -d flaresolverr
```

(A `docker-compose.yml` is included in the project root.)

## Usage in the SDK

```typescript
import { FlareSolverrClient, AnimePaheProvider, HttpClient } from 'ani-sdk';

const http = new HttpClient();
const flare = new FlareSolverrClient({ url: 'http://localhost:8191' });

// Check if FlareSolverr is available before using protected providers
if (await flare.isAvailable()) {
  const pahe = new AnimePaheProvider(http, { flaresolverr: flare });
  const results = await pahe.search('naruto');
  // ...
} else {
  console.warn('FlareSolverr not available — protected providers are disabled');
}
```

## Configuration Options

| Option | Default | Description |
|--------|---------|-------------|
| `url` | `http://localhost:8191` | URL to the FlareSolverr instance |
| `timeoutMs` | `60000` | Total request timeout in milliseconds |
| `maxTimeout` | `30000` | Max time FlareSolverr spends solving the CF challenge |

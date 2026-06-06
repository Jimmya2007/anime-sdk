import {
  HttpClient,
  startServer,
  GogoanimeProvider,
  GoyabuProvider,
  AllmangaProvider,
  AnimeParadiseProvider,
  AnikotoProvider,
  MegaPlayProvider,
  MangadexProvider,
  WeebcentralProvider,
  MangapillProvider,
  DomRegistry,
} from '../dist/index.js';

const http = new HttpClient({ timeoutMs: 30000 });
const domParser = DomRegistry.getParser();

// Trivial in-memory cache — a `Map` satisfies the SDK's get/set contract.
// Swap this for Redis/SQLite/edge-KV in production; add TTL by inspecting the
// key prefix (search: / content: / stream: / tracks:) and refusing or expiring
// entries as you see fit.
const store = new Map();
const MAX_ITEMS = 1000;
const cache = {
  get: (key) => store.get(key),
  set: (key, value) => {
    if (!store.has(key) && store.size >= MAX_ITEMS) {
      // Evict the oldest item
      const firstKey = store.keys().next().value;
      if (firstKey !== undefined) store.delete(firstKey);
    }
    store.set(key, value);
  },
};

startServer({
  providers: [
    new GogoanimeProvider(http),
    new GoyabuProvider(http),
    new AllmangaProvider(http),
    new AnimeParadiseProvider(http),
    new AnikotoProvider(http),
    new MegaPlayProvider(http),
    new MangadexProvider(http),
    new WeebcentralProvider(http),
    new MangapillProvider(http),
  ],
  port: Number(process.env.PORT ?? 3030),
  proxy: true,
  cache,
});

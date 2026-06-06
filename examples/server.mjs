import {
  HttpClient,
  startServer,
  GogoanimeProvider,
  GoyabuProvider,
  AllmangaProvider,
} from '../dist/index.js';

const http = new HttpClient({ timeoutMs: 30000 });

startServer({
  providers: [new GogoanimeProvider(http), new GoyabuProvider(http), new AllmangaProvider(http)],
  port: Number(process.env.PORT ?? 3001),
  proxy: true,
});

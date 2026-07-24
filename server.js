import { startServer, MegaPlayProvider, AnikotoProvider, HttpClient } from './dist/index.js';

const store = new Map();

startServer({
  providers: [
    new MegaPlayProvider(new HttpClient({ timeoutMs: 15000 })),
    new AnikotoProvider(new HttpClient({ timeoutMs: 15000 })),
  ],
  port: process.env.PORT || 3000,
  proxy: true,
  cache: {
    get: (k) => store.get(k),
    set: (k, v) => store.set(k, v),
  },
});

console.log('anime-sdk server running!');

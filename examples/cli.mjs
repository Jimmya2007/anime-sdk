import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { HttpClient, GogoanimeProvider, GoyabuProvider, AllmangaProvider } from '../dist/index.js';

const io = createInterface({ input: stdin, output: stdout });

const http = new HttpClient({ timeoutMs: 30000 });
const PROVIDERS = [
  new GogoanimeProvider(http),
  new GoyabuProvider(http),
  new AllmangaProvider(http),
];

async function pick(items, label) {
  items.forEach((item, i) => console.log(`  ${i + 1}. ${item}`));
  const n = Number(await io.question(`\n${label}: `)) - 1;
  return n;
}

console.log('\n═══ anime-sdk CLI ═══\n');

const pi = await pick(
  PROVIDERS.map((p) => p.id),
  'Provider',
);
const provider = PROVIDERS[pi];

const query = await io.question('\nSearch: ');
process.stdout.write('...\n');

const results = await provider.search(query);
if (!results.length) {
  console.log('No results.');
  process.exit(0);
}

console.log('');
const ri = await pick(
  results.map((r) => `${r.title}  [${r.catalogType}]`),
  'Select title',
);
const media = results[ri];

process.stdout.write('...\n');
const units = await provider.fetchContentUnits(media.id);
if (!units.length) {
  console.log('No episodes.');
  process.exit(0);
}

console.log('');
const ui = await pick(
  units.map((u) => `EP.${String(u.number).padStart(3, '0')}  ${u.title}  (${u.language})`),
  'Select episode',
);
const unit = units[ui];

process.stdout.write('...\n');
const stream = await provider.resolveStream(unit.id);

console.log('\n─── STREAM ───');
if (stream.type === 'video') {
  for (const s of stream.streams) {
    console.log(
      `\n[${s.isHLS ? 'HLS' : 'MP4'}] ${s.quality}${s.language ? '  ' + s.language : ''}`,
    );
    console.log(s.sourceUrl);
    if (s.headers && Object.keys(s.headers).length)
      console.log('headers:', JSON.stringify(s.headers));
  }
} else if (stream.type === 'manga') {
  console.log(`${stream.pages.imageUrls.length} pages`);
  stream.pages.imageUrls.slice(0, 3).forEach((u) => console.log(u));
}

io.close();

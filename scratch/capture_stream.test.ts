import { test, beforeAll } from 'vitest';
import { DOMParser as LinkeDomParser } from 'linkedom';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
// @ts-ignore
import puppeteer from 'puppeteer';
import { HttpClient } from '../src/transport/http.js';
import { SuperFlixProvider } from '../src/providers/SuperFlixProvider.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

beforeAll(() => {
  if (typeof globalThis.DOMParser === 'undefined') {
    globalThis.DOMParser = LinkeDomParser as any;
  }
});

test.skip('capture live streaming screenshots', async () => {
  const http = new HttpClient();
  const provider = new SuperFlixProvider(http);

  const query = 'Naruto';
  console.log(`[Capture] Searching for "${query}"...`);
  const searchResults = await provider.search(query);
  if (searchResults.length === 0) {
    throw new Error('No search results found');
  }

  const result = searchResults[0];
  console.log(`[Capture] Selected result: ${result.title} (${result.id})`);

  console.log(`[Capture] Fetching content units...`);
  const units = await provider.fetchContentUnits(result.id);
  if (units.length === 0) {
    throw new Error('No content units found');
  }
  const unit = units[0];
  console.log(`[Capture] Selected content unit: ${unit.title} (${unit.id})`);

  console.log(`[Capture] Resolving stream...`);
  const streamPayload = await provider.resolveStream(unit.id);
  if (streamPayload.type !== 'video' || streamPayload.streams.length === 0) {
    throw new Error('No video stream resolved');
  }

  const stream = streamPayload.streams[0];
  console.log(`[Capture] Resolved stream URL: ${stream.sourceUrl}`);
  console.log(`[Capture] Referer header required: ${stream.headers?.Referer}`);

  // Create the player HTML dynamically
  const playerHtmlPath = path.resolve(__dirname, 'player.html');
  const playerHtml = `
<!DOCTYPE html>
<html>
<head>
  <title>Scraper Stream Player</title>
  <script src="https://cdn.jsdelivr.net/npm/hls.js@1"></script>
  <style>
    body, html { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #000; }
    video { width: 100%; height: 100%; object-fit: contain; }
  </style>
</head>
<body>
  <video id="video" autoplay muted playsinline></video>
  <script>
    const video = document.getElementById('video');
    const streamUrl = '${stream.sourceUrl}';
    const referer = '${stream.headers?.Referer || ''}';

    if (Hls.isSupported()) {
      const hls = new Hls({
        xhrSetup: function (xhr, url) {
          if (referer) {
            xhr.setRequestHeader('Referer', referer);
          }
        }
      });
      hls.loadSource(streamUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, function() {
        video.play().catch(e => console.error("Play failed:", e));
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = streamUrl;
      video.play().catch(e => console.error("Play failed:", e));
    }
  </script>
</body>
</html>
  `;

  console.log(`[Capture] Writing player HTML to: ${playerHtmlPath}`);
  fs.writeFileSync(playerHtmlPath, playerHtml, 'utf8');

  console.log(`[Capture] Launching browser to load video player...`);
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-web-security',
      '--allow-file-access-from-files',
    ]
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    console.log(`[Capture] Loading player page...`);
    await page.goto(`file://${playerHtmlPath}`, { waitUntil: 'load' });

    console.log(`[Capture] Waiting 15 seconds for video buffering and playback...`);
    // Wait for the video elements to initialize and play
    await new Promise((resolve) => setTimeout(resolve, 15000));

    // Capture screenshots directly to the artifacts directory
    const screenshotDir = '/Users/fth-prosoftware/.gemini/antigravity/brain/f4ab0aba-b61d-418f-be0c-dab587293637';
    const path1 = path.join(screenshotDir, 'stream_screenshot_1.png');
    const path2 = path.join(screenshotDir, 'stream_screenshot_2.png');

    console.log(`[Capture] Capturing screenshot 1 to: ${path1}`);
    await page.screenshot({ path: path1 });

    console.log(`[Capture] Waiting another 5 seconds...`);
    await new Promise((resolve) => setTimeout(resolve, 5000));

    console.log(`[Capture] Capturing screenshot 2 to: ${path2}`);
    await page.screenshot({ path: path2 });

    console.log(`[Capture] Video streams captured successfully!`);
  } finally {
    await browser.close();
    try {
      fs.unlinkSync(playerHtmlPath);
    } catch (_) {}
  }
}, 120000); // 120-second timeout for streaming capture

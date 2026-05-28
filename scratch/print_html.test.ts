import { test } from 'vitest';
// @ts-ignore
import { connect } from 'puppeteer-real-browser';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test.skip('print player html variables', async () => {
  const url = 'https://superflixapi.best/filme/638566';
  console.log(`Solving ${url}...`);
  
  const { browser, page } = await connect({
    headless: false,
    turnstile: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--window-position=-2000,-2000',
    ],
  });

  try {
    console.log(`Navigating to partner URL: https://noveflix.xyz/filme/naruto-to-boruto-the-live-2019...`);
    await page.goto('https://noveflix.xyz/filme/naruto-to-boruto-the-live-2019', { waitUntil: 'domcontentloaded', timeout: 60000 });
    
    let title = await page.title();
    console.log(`Partner page title: "${title}".`);
    
    console.log("Clicking fake player play button...");
    await page.waitForSelector('#movie-fake-player-btn', { timeout: 10000 });
    await page.click('#movie-fake-player-btn');
    
    console.log("Clicking superflixapi.best source button...");
    await page.waitForSelector('button[data-api="superflixapi.best"]', { timeout: 10000 });
    await page.click('button[data-api="superflixapi.best"]');
    
    console.log("Waiting 10 seconds for embed iframe to load and solve Cloudflare...");
    await new Promise((resolve) => setTimeout(resolve, 10000));

    const frames = page.frames();
    console.log(`Total partner page frames found: ${frames.length}`);
    
    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i];
      const frameUrl = frame.url();
      console.log(`Frame ${i}: ${frameUrl}`);
      
      try {
        const content = await frame.content();
        const lines = content.split('\n');
        let matched = false;
        for (const line of lines) {
          const trimmed = line.trim();
          if (
            trimmed.includes('CSRF_TOKEN') ||
            trimmed.includes('PAGE_TOKEN') ||
            trimmed.includes('INITIAL_CONTENT_ID') ||
            trimmed.includes('CONTENT_TYPE')
          ) {
            console.log(`  [MATCH in Frame ${i}]: ${trimmed}`);
            matched = true;
          }
        }
        const outputPath = path.resolve(__dirname, `partner_frame_${i}.html`);
        fs.writeFileSync(outputPath, content, 'utf8');
        console.log(`  Saved Partner Frame ${i} HTML to ${outputPath}`);
      } catch (e) {
        console.log(`  Frame ${i} error: ${(e as Error).message}`);
      }
    }

    console.log("Finished partner page inspection.");
  } finally {
    await browser.close();
  }
}, 90000);

/**
 * Stealth Cloudflare challenge solver.
 * Uses puppeteer-real-browser to solve Turnstile / Verification challenges.
 * This is dynamically imported to keep the SDK environment-agnostic.
 */
export async function solveCloudflare(
  url: string,
  options: {
    userAgent?: string;
    headers?: Record<string, string>;
    automation?: (page: any, browser: any) => Promise<{ html: string; customData?: any }>;
  } = {}
): Promise<{
  html: string;
  cookies: { name: string; value: string }[];
  userAgent: string;
  customData?: any;
}> {
  if (typeof window !== 'undefined') {
    throw new Error('solveCloudflare can only be executed in Node.js environments.');
  }

  // Dynamically import to prevent browser bundling compilation errors
  // @ts-ignore
  const { connect } = await import('puppeteer-real-browser');

  console.log(`StealthSolver: Connecting puppeteer-real-browser to solve: ${url}`);
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
    if (options.headers) {
      await page.setExtraHTTPHeaders(options.headers);
    }

    console.log(`StealthSolver: Navigating to ${url}...`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Poll the page title to check if the Turnstile check has solved
    let title = await page.title();
    let retries = 25; // 25 retries * 2s = 50 seconds max wait
    console.log(`StealthSolver: Initial page title: "${title}". Waiting for verification...`);

    while (
      (title.includes('Verificação') ||
        title.includes('Just a moment') ||
        title.includes('Attention Required') ||
        title.includes('Cloudflare')) &&
      retries > 0
    ) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      try {
        title = await page.title();
      } catch (err) {
        // Ignore errors checking title during redirection
      }
      retries--;
    }

    if (options.automation) {
      console.log('StealthSolver: Running custom provider automation...');
      const autoResult = await options.automation(page, browser);
      const cookies = await page.cookies();
      const actualUserAgent = await page.evaluate(() => navigator.userAgent);
      return {
        html: autoResult.html,
        cookies: cookies.map((c: any) => ({ name: c.name, value: c.value })),
        userAgent: actualUserAgent,
        customData: autoResult.customData,
      };
    }

    // Wait a brief moment to ensure cookies are written
    await new Promise((resolve) => setTimeout(resolve, 3000));

    const html = await page.content();
    const cookies = await page.cookies();
    const actualUserAgent = await page.evaluate(() => navigator.userAgent);

    console.log(`StealthSolver: Challenge finished. Title: "${title}". Retrieved ${cookies.length} cookies.`);

    return {
      html,
      cookies: cookies.map((c: any) => ({ name: c.name, value: c.value })),
      userAgent: actualUserAgent,
    };
  } finally {
    await browser.close();
  }
}

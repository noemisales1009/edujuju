import { chromium } from 'playwright';
import { mkdir } from 'fs/promises';

const BASE = 'http://localhost:3000';
const OUT = './review-screenshots';

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

async function shot(name, action) {
  await action();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  console.log(`✓ ${name}`);
}

// Login page
await shot('01-login', async () => {
  await page.goto(BASE, { waitUntil: 'networkidle' });
});

// Try to see what sections exist without login
await shot('02-after-load', async () => {
  await page.waitForTimeout(1000);
});

// Check if there's a sidebar or navigation
const nav = await page.$('nav, .sidebar, [class*="sidebar"], [class*="menu"]');
console.log('Nav found:', !!nav);

// Scroll down to see more
await shot('03-scrolled', async () => {
  await page.evaluate(() => window.scrollTo(0, 400));
});

await browser.close();
console.log('Done! Screenshots saved to', OUT);

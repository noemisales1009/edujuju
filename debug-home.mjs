import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const errors = [];
const logs = [];

page.on('console', msg => {
  logs.push(`[${msg.type()}] ${msg.text()}`);
});
page.on('pageerror', err => {
  errors.push(err.message);
});

await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);

// Force app shell visible and trigger loadHome equivalent
await page.evaluate(() => {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('appShell').style.display = 'block';
});

await page.waitForTimeout(500);

console.log('\n=== ERROS JS ===');
errors.forEach(e => console.log('ERROR:', e));

console.log('\n=== LOGS ===');
logs.forEach(l => console.log(l));

// Check DOM structure
const checks = await page.evaluate(() => {
  return {
    artigoEmptyState: !!document.getElementById('artigoEmptyState'),
    artigoConteudoWrap: !!document.getElementById('artigoConteudoWrap'),
    avaliacaoEmptyState: !!document.getElementById('avaliacaoEmptyState'),
    avaliacaoConteudoWrap: !!document.getElementById('avaliacaoConteudoWrap'),
    homeTrilhasGrid: !!document.getElementById('homeTrilhasGrid'),
    homeRingFill: !!document.getElementById('homeRingFill'),
    pageAdmin: !!document.getElementById('page-admin'),
    appShell: !!document.getElementById('appShell'),
  };
});

console.log('\n=== ELEMENTOS DOM ===');
Object.entries(checks).forEach(([k, v]) => console.log(`${k}: ${v ? '✓' : '✗ AUSENTE'}`));

await browser.close();

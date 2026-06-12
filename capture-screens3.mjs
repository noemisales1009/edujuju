import { chromium } from 'playwright';
import { mkdir } from 'fs/promises';

const BASE = 'http://localhost:3000';
const OUT = './review-screenshots';

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

async function shot(name, fullPage = false) {
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage });
  console.log(`✓ ${name}`);
}

await page.goto(BASE, { waitUntil: 'networkidle' });

// Force show the entire app layout
await page.evaluate(() => {
  // Remove all the hiding rules
  const styleEl = document.createElement('style');
  styleEl.textContent = `
    #loginScreen { display: none !important; }
    .sidebar, .topbar, .bottom-nav { display: flex !important; }
    #mainApp { display: flex !important; opacity: 1 !important; }
    .page { display: none !important; }
    .page.active { display: flex !important; }
  `;
  document.head.appendChild(styleEl);

  const login = document.getElementById('loginScreen');
  if (login) login.style.display = 'none';

  const app = document.getElementById('mainApp');
  if (app) { app.style.display = 'flex'; app.style.opacity = '1'; }

  const sidebar = document.getElementById('sidebar');
  if (sidebar) { sidebar.style.display = 'flex'; sidebar.style.visibility = 'visible'; }

  const topbar = document.querySelector('.topbar');
  if (topbar) { topbar.style.display = 'flex'; topbar.style.visibility = 'visible'; }

  const bnav = document.querySelector('.bottom-nav');
  if (bnav) { bnav.style.display = 'flex'; bnav.style.visibility = 'visible'; }
});

// Helper to activate a page
async function showPage(pageId) {
  await page.evaluate((id) => {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const p = document.getElementById(id);
    if (p) p.classList.add('active');
    // Update nav active state
    document.querySelectorAll('.nav-item, .bnav-item').forEach(el => {
      el.classList.toggle('active', el.dataset.page === id.replace('page-', ''));
    });
  }, pageId);
}

// Home
await showPage('page-home');
await shot('02-home');

// Catalogo
await showPage('page-catalogo');
await shot('03-catalogo');

// Artigos
await showPage('page-artigo');
await shot('04-artigos');

// Avaliacao
await showPage('page-avaliacao');
await shot('05-avaliacao');

// Sala de Aula
await showPage('page-sala');
await shot('06-sala');

// Documentos
await showPage('page-documentos');
await shot('07-documentos');

// Admin
await showPage('page-admin');
await shot('08-admin');
await shot('08-admin-full', true);

// Perfil
await showPage('page-perfil');
await shot('09-perfil');

await browser.close();
console.log('Done!');

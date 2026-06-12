import { chromium } from 'playwright';
import { mkdir } from 'fs/promises';

const BASE = 'http://localhost:3000';
const OUT = './review-screenshots';

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

async function shot(name, fullPage = false) {
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage });
  console.log(`✓ ${name}`);
}

await page.goto(BASE, { waitUntil: 'networkidle' });

// Reveal the app shell
await page.evaluate(() => {
  const login = document.getElementById('loginScreen');
  if (login) login.style.display = 'none';

  const shell = document.getElementById('appShell');
  if (shell) shell.style.display = 'block';

  const sidebar = document.getElementById('sidebar');
  if (sidebar) { sidebar.style.display = 'flex'; sidebar.style.removeProperty('visibility'); }

  const topbar = document.querySelector('.topbar');
  if (topbar) topbar.style.display = 'flex';

  const bnav = document.querySelector('.bottom-nav');
  if (bnav) bnav.style.display = 'flex';

  // Fill fake user info in sidebar
  const sname = document.querySelector('.sidebar-name');
  if (sname) sname.textContent = 'Noemi Sales';
  const srole = document.querySelector('.sidebar-role');
  if (srole) srole.textContent = 'Administradora';
  const topUser = document.querySelector('.topbar-user-name, .user-name');
  if (topUser) topUser.textContent = 'Noemi Sales';
});

async function showPage(pageId, label) {
  await page.evaluate((id) => {
    document.querySelectorAll('.page').forEach(p => { p.classList.remove('active'); p.style.display = 'none'; });
    const p = document.getElementById(id);
    if (p) { p.classList.add('active'); p.style.display = 'flex'; }
    document.querySelectorAll('.nav-item, .bnav-item').forEach(el => {
      el.classList.toggle('active', el.dataset.page === id.replace('page-', ''));
    });
  }, pageId);
  await shot(label);
}

await showPage('page-home', '02-home');
await showPage('page-catalogo', '03-catalogo');
await showPage('page-artigo', '04-artigos');
await showPage('page-avaliacao', '05-avaliacao');
await showPage('page-sala', '06-sala');
await showPage('page-documentos', '07-documentos');
await showPage('page-admin', '08-admin');

// Admin full page
await page.evaluate(() => {
  document.querySelectorAll('.page').forEach(p => { p.classList.remove('active'); p.style.display = 'none'; });
  const p = document.getElementById('page-admin');
  if (p) { p.classList.add('active'); p.style.display = 'flex'; }
});
await shot('08-admin-full', true);

await showPage('page-perfil', '09-perfil');

await browser.close();
console.log('Done!');

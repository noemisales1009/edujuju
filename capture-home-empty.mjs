import { chromium } from 'playwright';
import { mkdir } from 'fs/promises';

const BASE = 'http://localhost:3000';
const OUT = './review-screenshots';
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(BASE, { waitUntil: 'networkidle' });

await page.evaluate(() => {
  document.getElementById('loginScreen').style.display = 'none';
  const shell = document.getElementById('appShell');
  shell.style.display = 'block';
  document.getElementById('sidebar').style.display = 'flex';
  document.querySelector('.topbar').style.display = 'flex';
  document.querySelector('.bottom-nav').style.display = 'flex';
  document.querySelector('.sidebar-name').textContent = 'Noemi Sales';
  document.querySelector('.sidebar-role').textContent = 'Administradora';

  document.querySelectorAll('.page').forEach(p => { p.classList.remove('active'); p.style.display = 'none'; });
  const home = document.getElementById('page-home');
  home.classList.add('active'); home.style.display = 'flex';

  // Simulate empty trilhas state
  const grid = document.getElementById('homeTrilhasGrid');
  grid.innerHTML = `
    <div class="home-empty-state">
      <span class="material-symbols-outlined" style="font-size:2.5rem;color:var(--primary);opacity:0.5">school</span>
      <p style="margin:0.5rem 0 0.25rem;font-weight:600;color:var(--on-surface)">Nenhuma trilha disponível ainda</p>
      <p style="margin:0;font-size:0.85rem;color:var(--text-secondary)">Quando o administrador cadastrar conteúdo, suas trilhas aparecem aqui.</p>
      <button class="btn-primary" style="margin-top:1rem;padding:0.5rem 1.25rem;font-size:0.9rem">
        <span class="material-symbols-outlined" style="font-size:1rem;vertical-align:middle;margin-right:0.25rem">explore</span>
        Explorar Catálogo
      </button>
    </div>`;
});

await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/02-home-empty.png` });
console.log('✓ home com estado vazio');
await browser.close();

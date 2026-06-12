import { chromium } from 'playwright';
import { mkdir } from 'fs/promises';

const BASE = 'http://localhost:3000';
const OUT = './review-screenshots';

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

async function shot(name) {
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  console.log(`✓ ${name}`);
}

// Load page and bypass auth by injecting fake session state
await page.goto(BASE, { waitUntil: 'networkidle' });

// Reveal main app and hide login
await page.evaluate(() => {
  const login = document.getElementById('loginScreen');
  const app = document.getElementById('mainApp');
  if (login) login.style.display = 'none';
  if (app) {
    app.style.display = 'flex';
    app.style.opacity = '1';
  }
  // Set active page to home
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const home = document.getElementById('page-home');
  if (home) home.classList.add('active');
  // Show admin nav if present
  document.querySelectorAll('[data-admin], .nav-admin').forEach(el => el.style.display = 'flex');
});

await shot('02-home');

// Switch to Catalogo
await page.evaluate(() => {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const p = document.getElementById('page-catalogo');
  if (p) p.classList.add('active');
});
await shot('03-catalogo');

// Switch to Artigos
await page.evaluate(() => {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const p = document.getElementById('page-artigo');
  if (p) p.classList.add('active');
});
await shot('04-artigos');

// Switch to Avaliacao
await page.evaluate(() => {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const p = document.getElementById('page-avaliacao');
  if (p) p.classList.add('active');
});
await shot('05-avaliacao');

// Switch to Sala
await page.evaluate(() => {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const p = document.getElementById('page-sala');
  if (p) p.classList.add('active');
});
await shot('06-sala');

// Switch to Documentos
await page.evaluate(() => {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const p = document.getElementById('page-documentos');
  if (p) p.classList.add('active');
});
await shot('07-documentos');

// Switch to Admin
await page.evaluate(() => {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const p = document.getElementById('page-admin');
  if (p) p.classList.add('active');
});
await shot('08-admin');

// Switch to Perfil
await page.evaluate(() => {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const p = document.getElementById('page-perfil');
  if (p) p.classList.add('active');
});
await shot('09-perfil');

// Full page of admin section
await page.evaluate(() => {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const p = document.getElementById('page-admin');
  if (p) p.classList.add('active');
});
await page.screenshot({ path: `${OUT}/08-admin-full.png`, fullPage: true });
console.log('✓ 08-admin-full (full page)');

await browser.close();
console.log('Done!');

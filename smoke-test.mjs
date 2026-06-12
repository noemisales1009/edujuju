// Smoke test — carrega o app com rede real e captura erros de JS/console/rede
import { chromium } from 'playwright';

const BASE = 'http://localhost:3000';
const consoleErrors = [];
const pageErrors = [];
const failedRequests = [];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
page.on('pageerror', err => pageErrors.push(err.message));
page.on('requestfailed', req => failedRequests.push(`${req.method()} ${req.url()} — ${req.failure()?.errorText}`));
page.on('response', res => {
  if (res.status() >= 400) failedRequests.push(`HTTP ${res.status()} ${res.url().slice(0, 120)}`);
});

console.log('1. Carregando app...');
await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(2000);

console.log('2. Login com credenciais inválidas (testa tratamento de erro)...');
await page.locator('#loginEmail').fill('naoexiste@teste.com');
await page.locator('#loginPassword').fill('senhaerrada123');
await page.locator('#loginBtn').click();
await page.waitForTimeout(3000);
const loginErr = await page.locator('#loginError').textContent().catch(() => '');
console.log(`   Mensagem de erro exibida: "${(loginErr || '').trim() || '(NENHUMA — possível bug)'}"`);
const stillOnLogin = await page.locator('#loginScreen').isVisible();
console.log(`   Continua na tela de login: ${stillOnLogin}`);

console.log('3. Teste de validação: registro com senha curta...');
await page.locator('#tabRegister').click();
await page.waitForTimeout(300);
await page.locator('#regName').fill('Usuario Teste');
const setorOpts = await page.locator('#regSetor option').count();
const funcaoOpts = await page.locator('#regFuncao option').count();
console.log(`   Opções de Setor: ${setorOpts}, Funções: ${funcaoOpts}`);
if (setorOpts > 1) await page.locator('#regSetor').selectOption({ index: 1 });
if (funcaoOpts > 1) await page.locator('#regFuncao').selectOption({ index: 1 });
await page.locator('#regEmail').fill('teste@hospital.com');
await page.locator('#regPassword').fill('123');
await page.locator('#regBtn').click();
await page.waitForTimeout(1500);
const regErr = await page.locator('#regError').textContent().catch(() => '');
const minLen = await page.locator('#regPassword').evaluate(el => ({ tooShort: el.validity.tooShort, minLength: el.minLength }));
console.log(`   Erro exibido: "${(regErr || '').trim() || '(nenhum)'}" | HTML5 tooShort: ${minLen.tooShort} (minLength=${minLen.minLength})`);
const stillOnLogin2 = await page.locator('#loginScreen').isVisible();
console.log(`   Continua na tela de login (registro não passou): ${stillOnLogin2}`);

console.log('\n========== RESULTADO ==========');
console.log(`Erros de página (exceções JS): ${pageErrors.length}`);
pageErrors.forEach(e => console.log(`  ❌ ${e}`));
const relevantConsole = consoleErrors.filter(e => !e.toLowerCase().includes('favicon') && !e.includes('400 ()') === false || true).filter(e => !e.toLowerCase().includes('favicon'));
console.log(`Erros de console: ${relevantConsole.length}`);
relevantConsole.forEach(e => console.log(`  ⚠️ ${e.slice(0, 200)}`));
console.log(`Requisições com falha/4xx/5xx: ${failedRequests.length}`);
failedRequests.forEach(e => console.log(`  🌐 ${e}`));

await browser.close();

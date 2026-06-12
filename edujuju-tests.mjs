// EduJuju UI Test Script — Playwright (ESM, no config file needed)
// Run: node edujuju-tests.mjs

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/noemi.sales/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright');
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.join(__dirname, 'test-screenshots');
const BASE_URL = 'http://localhost:3000';

if (!existsSync(SCREENSHOTS_DIR)) mkdirSync(SCREENSHOTS_DIR, { recursive: true });

const results = [];

function log(testName, status, detail = '') {
  const icon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : 'ℹ️';
  const msg = `${icon} [${testName}] ${detail}`;
  console.log(msg);
  results.push({ testName, status, detail });
}

async function shot(page, name) {
  const file = path.join(SCREENSHOTS_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`   📸 Screenshot saved: ${name}.png`);
  return file;
}

async function runTests() {
  console.log('\n======================================');
  console.log('   EduJuju UI Tests — Playwright');
  console.log('======================================\n');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  // Collect console errors
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', err => {
    consoleErrors.push(`PAGE ERROR: ${err.message}`);
  });

  try {
    // ─────────────────────────────────────────────
    // TEST 1: Login page loads with expected elements
    // ─────────────────────────────────────────────
    console.log('\n--- TEST 1: Login page load ---');
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 15000 });
    await shot(page, '01-login-page');

    // EduJuju brand
    const brandText = await page.locator('.login-brand').textContent().catch(() => null);
    if (brandText && brandText.includes('EduJuju')) {
      log('Test 1 - EduJuju Logo/Brand', 'PASS', `Brand text: "${brandText.trim()}"`);
    } else {
      log('Test 1 - EduJuju Logo/Brand', 'FAIL', `Brand text found: "${brandText}"`);
    }

    // Email field
    const emailInput = page.locator('#loginEmail');
    const emailVisible = await emailInput.isVisible();
    log('Test 1 - Email field visible', emailVisible ? 'PASS' : 'FAIL', emailVisible ? 'Email input present' : 'Email input NOT found');

    // Senha (password) field
    const passInput = page.locator('#loginPassword');
    const passVisible = await passInput.isVisible();
    log('Test 1 - Senha field visible', passVisible ? 'PASS' : 'FAIL', passVisible ? 'Password input present' : 'Password input NOT found');

    // "Entrar" tab
    const tabLogin = page.locator('#tabLogin');
    const tabLoginText = await tabLogin.textContent().catch(() => null);
    const tabLoginVisible = await tabLogin.isVisible();
    log('Test 1 - Entrar tab', tabLoginVisible ? 'PASS' : 'FAIL', `Tab text: "${tabLoginText?.trim()}"`);

    // "Criar Conta" tab
    const tabRegister = page.locator('#tabRegister');
    const tabRegisterText = await tabRegister.textContent().catch(() => null);
    const tabRegisterVisible = await tabRegister.isVisible();
    log('Test 1 - Criar Conta tab', tabRegisterVisible ? 'PASS' : 'FAIL', `Tab text: "${tabRegisterText?.trim()}"`);

    // ─────────────────────────────────────────────
    // TEST 2: Click "Criar Conta" tab → registration form appears
    // ─────────────────────────────────────────────
    console.log('\n--- TEST 2: Criar Conta tab click ---');
    await page.locator('#tabRegister').click();
    await page.waitForTimeout(300);
    await shot(page, '02-register-form');

    const registerForm = page.locator('#registerForm');
    const registerVisible = await registerForm.isVisible();
    log('Test 2 - Register form visible', registerVisible ? 'PASS' : 'FAIL',
      registerVisible ? 'Register form appeared' : 'Register form NOT visible');

    // Login form should now be hidden
    const loginFormHidden = !(await page.locator('#loginForm').isVisible());
    log('Test 2 - Login form hidden', loginFormHidden ? 'PASS' : 'FAIL',
      loginFormHidden ? 'Login form hidden as expected' : 'Login form still visible (unexpected)');

    // Nome field
    const regName = page.locator('#regName');
    const regNameVisible = await regName.isVisible();
    const regNameValue = await regName.inputValue().catch(() => null);
    log('Test 2 - Nome field empty', (regNameVisible && regNameValue === '') ? 'PASS' : 'FAIL',
      `Nome visible: ${regNameVisible}, value: "${regNameValue}"`);

    // Setor dropdown
    const regSetor = page.locator('#regSetor');
    const regSetorVisible = await regSetor.isVisible();
    const regSetorValue = await regSetor.inputValue().catch(() => null);
    log('Test 2 - Setor dropdown empty', (regSetorVisible && regSetorValue === '') ? 'PASS' : 'FAIL',
      `Setor visible: ${regSetorVisible}, value: "${regSetorValue}"`);

    // Funcao dropdown
    const regFuncao = page.locator('#regFuncao');
    const regFuncaoVisible = await regFuncao.isVisible();
    const regFuncaoValue = await regFuncao.inputValue().catch(() => null);
    log('Test 2 - Funcao dropdown empty', (regFuncaoVisible && regFuncaoValue === '') ? 'PASS' : 'FAIL',
      `Funcao visible: ${regFuncaoVisible}, value: "${regFuncaoValue}"`);

    // Email field in register
    const regEmail = page.locator('#regEmail');
    const regEmailVisible = await regEmail.isVisible();
    log('Test 2 - Email field in register', regEmailVisible ? 'PASS' : 'FAIL', `visible: ${regEmailVisible}`);

    // Senha field in register
    const regPass = page.locator('#regPassword');
    const regPassVisible = await regPass.isVisible();
    log('Test 2 - Senha field in register', regPassVisible ? 'PASS' : 'FAIL', `visible: ${regPassVisible}`);

    // ─────────────────────────────────────────────
    // TEST 3: "Acesso restrito" text on login form
    // ─────────────────────────────────────────────
    console.log('\n--- TEST 3: Restricted access text ---');
    // Switch back to login tab
    await page.locator('#tabLogin').click();
    await page.waitForTimeout(300);
    await shot(page, '03-login-restricted-text');

    const bodyText = await page.locator('body').textContent();
    const hasRestrictedText = bodyText.includes('Acesso restrito a profissionais autorizados');
    log('Test 3 - Restricted access text', hasRestrictedText ? 'PASS' : 'FAIL',
      hasRestrictedText
        ? 'Text "Acesso restrito a profissionais autorizados" found'
        : 'Text NOT found on page');

    // ─────────────────────────────────────────────
    // TEST 4: JavaScript console errors on load
    // ─────────────────────────────────────────────
    console.log('\n--- TEST 4: Console errors ---');
    // Filter out non-critical network errors (Supabase may fail if offline)
    const criticalErrors = consoleErrors.filter(e =>
      !e.includes('supabase') &&
      !e.includes('net::ERR_') &&
      !e.includes('Failed to fetch') &&
      !e.includes('ERR_NAME_NOT_RESOLVED') &&
      !e.toLowerCase().includes('cors') &&
      !e.toLowerCase().includes('favicon')
    );

    if (criticalErrors.length === 0) {
      log('Test 4 - No critical JS errors', 'PASS', `Total console errors: ${consoleErrors.length} (all Supabase/network, not critical)`);
    } else {
      log('Test 4 - No critical JS errors', 'FAIL', `Critical errors found:\n   ${criticalErrors.join('\n   ')}`);
    }

    if (consoleErrors.length > 0) {
      console.log(`   All console errors detected (${consoleErrors.length}):`);
      consoleErrors.forEach(e => console.log(`     - ${e.slice(0, 120)}`));
    }

    // ─────────────────────────────────────────────
    // TEST 5: Submit login form with empty fields
    // ─────────────────────────────────────────────
    console.log('\n--- TEST 5: Login form empty submit ---');
    await page.locator('#tabLogin').click();
    await page.waitForTimeout(200);

    // Clear fields just in case
    await page.locator('#loginEmail').fill('');
    await page.locator('#loginPassword').fill('');

    // Try to submit
    await page.locator('#loginBtn').click();
    await page.waitForTimeout(800);
    await shot(page, '05-login-empty-submit');

    // Check if HTML5 validation prevented submission (login screen still visible)
    const loginScreenStillVisible = await page.locator('#loginScreen').isVisible();

    // Check for validation message via JS (browser native validation)
    const emailValidity = await page.locator('#loginEmail').evaluate(el => ({
      valid: el.validity.valid,
      valueMissing: el.validity.valueMissing
    }));

    // Check if error message appeared
    const loginError = page.locator('#loginError');
    const loginErrorText = await loginError.textContent().catch(() => '');

    if (loginScreenStillVisible) {
      log('Test 5 - Empty login validation', 'PASS',
        `Login screen still shown (not submitted). Email valueMissing: ${emailValidity.valueMissing}. Error text: "${loginErrorText.trim() || 'none (browser HTML5 validation prevented submit)'}"`);
    } else {
      log('Test 5 - Empty login validation', 'FAIL', 'Login screen disappeared — form was submitted without validation!');
    }

    // ─────────────────────────────────────────────
    // TEST 6: Register form without Setor/Funcao → Portuguese error
    // ─────────────────────────────────────────────
    console.log('\n--- TEST 6: Register form missing Setor/Funcao ---');
    await page.locator('#tabRegister').click();
    await page.waitForTimeout(300);

    // Fill only Nome and Email/Password but skip Setor and Funcao
    await page.locator('#regName').fill('Teste Usuario');
    await page.locator('#regEmail').fill('teste@teste.com');
    await page.locator('#regPassword').fill('senha123');
    // Do NOT select Setor or Funcao

    await page.locator('#regBtn').click();
    await page.waitForTimeout(800);
    await shot(page, '06-register-missing-setor-funcao');

    const regError = page.locator('#regError');
    const regErrorText = await regError.textContent().catch(() => '');

    if (regErrorText.includes('Selecione seu setor e sua função')) {
      log('Test 6 - Missing Setor/Funcao validation', 'PASS', `Error message: "${regErrorText.trim()}"`);
    } else if (regErrorText.trim()) {
      log('Test 6 - Missing Setor/Funcao validation', 'FAIL',
        `Different error shown: "${regErrorText.trim()}" (expected "Selecione seu setor e sua função")`);
    } else {
      // Check if browser native validation stopped it
      const setorValidity = await page.locator('#regSetor').evaluate(el => el.validity.valueMissing);
      log('Test 6 - Missing Setor/Funcao validation', setorValidity ? 'INFO' : 'FAIL',
        setorValidity
          ? 'Browser HTML5 required validation stopped form (Setor empty). Custom JS error may not have fired.'
          : 'No error shown and no HTML5 validation — validation may be broken');
    }

    // Extra: Test with Nome missing (should show "Preencha seu nome completo")
    console.log('\n--- BONUS: Register form missing Nome ---');
    await page.locator('#regName').fill('');
    await page.locator('#regBtn').click();
    await page.waitForTimeout(500);

    const regErrorTextNoName = await page.locator('#regError').textContent().catch(() => '');
    if (regErrorTextNoName.includes('Preencha seu nome completo')) {
      log('BONUS - Missing Nome validation', 'PASS', `"${regErrorTextNoName.trim()}"`);
    } else {
      log('BONUS - Missing Nome validation', 'INFO', `Error shown: "${regErrorTextNoName.trim() || 'none'}"`);
    }

  } catch (err) {
    log('FATAL ERROR', 'FAIL', err.message);
    console.error(err);
  } finally {
    await browser.close();
  }

  // ─────────────────────────────────────────────
  // SUMMARY
  // ─────────────────────────────────────────────
  console.log('\n======================================');
  console.log('   TEST SUMMARY');
  console.log('======================================');
  const passed  = results.filter(r => r.status === 'PASS').length;
  const failed  = results.filter(r => r.status === 'FAIL').length;
  const info    = results.filter(r => r.status === 'INFO').length;
  console.log(`✅ PASSED: ${passed}`);
  console.log(`❌ FAILED: ${failed}`);
  console.log(`ℹ️  INFO:   ${info}`);
  console.log(`📁 Screenshots saved to: ${SCREENSHOTS_DIR}`);
  console.log('======================================\n');
  return { passed, failed, results };
}

runTests().catch(console.error);

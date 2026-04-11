/**
 * Selenium smoke test — workspace session behavior
 *
 * Verifies:
 * - SSH duplicate tabs are allowed
 * - Database duplicate tabs are allowed
 * - RDP duplicate opens focus the existing tab instead of creating a second tab
 * - Database session settings are available from the docked toolbar
 * - The old top-bar run/settings buttons are no longer duplicated
 *
 * Usage:
 *   node e2e/workspace-session-behavior.test.mjs [base-url]
 *
 * Defaults to http://localhost:3000
 */

import { Builder, By, until } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';

const BASE_URL = process.argv[2] || 'http://localhost:3000';
const LOGIN_EMAIL = process.env.ARSENALE_EMAIL || 'admin@example.com';
const LOGIN_PASSWORD = process.env.ARSENALE_PASSWORD || 'ArsenaleTemp91Qx';
const TIMEOUT = 20_000;

const SSH_CONNECTION = 'smarthome-services';
const DB_CONNECTION = 'Dev Demo PostgreSQL';
const RDP_CONNECTION = 'vg-generic';

/** @type {import('selenium-webdriver').WebDriver} */
let driver;
let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed += 1;
    console.log(`  \x1b[32m✓\x1b[0m ${message}`);
  } else {
    failed += 1;
    console.error(`  \x1b[31m✗\x1b[0m ${message}`);
  }
}

async function waitFor(locator, timeout = TIMEOUT) {
  return driver.wait(until.elementLocated(locator), timeout);
}

async function waitVisible(locator, timeout = TIMEOUT) {
  const el = await waitFor(locator, timeout);
  await driver.wait(until.elementIsVisible(el), timeout);
  return el;
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function elementExists(locator) {
  try {
    await driver.findElement(locator);
    return true;
  } catch {
    return false;
  }
}

async function visibleElements(locator) {
  const elements = await driver.findElements(locator);
  const visible = [];
  for (const element of elements) {
    try {
      if (await element.isDisplayed()) {
        visible.push(element);
      }
    } catch {
      // Ignore stale elements while the UI is settling.
    }
  }
  return visible;
}

async function waitForVisibleCount(locator, expectedCount, timeout = TIMEOUT) {
  await driver.wait(async () => {
    const elements = await visibleElements(locator);
    return elements.length === expectedCount;
  }, timeout);
}

function tabContainerLocator(name) {
  return By.xpath(`//div[contains(@class,'group inline-flex')][.//span[normalize-space()="${name}"]]`);
}

function tabButtonLocator(name) {
  return By.xpath(`//div[contains(@class,'group inline-flex')][.//span[normalize-space()="${name}"]]//button[.//span[normalize-space()="${name}"]]`);
}

function tabCloseButtonLocator(name) {
  return By.css(`button[aria-label="Close ${name}"]`);
}

async function findVisibleElement(locator, timeout = TIMEOUT) {
  await driver.wait(async () => (await visibleElements(locator)).length > 0, timeout);
  const elements = await visibleElements(locator);
  if (elements.length === 0) {
    throw new Error(`No visible element found for locator: ${locator}`);
  }
  return elements[0];
}

async function clickVisible(locator) {
  const element = await findVisibleElement(locator);
  await driver.executeScript('arguments[0].scrollIntoView({ block: "center" });', element);
  await element.click();
}

async function openConnectionFromPalette(name) {
  await clickVisible(By.xpath("//footer//button[.//span[normalize-space()='Cmd+K']]"));
  const searchInput = await waitVisible(By.css('input[data-slot="command-input"]'));
  await searchInput.clear();
  await searchInput.sendKeys(name);
  await clickVisible(By.xpath(`//*[@data-slot="command-item"][.//span[normalize-space()="${name}"]]`));
}

async function tabCloseCount(name) {
  const elements = await visibleElements(tabCloseButtonLocator(name));
  return elements.length;
}

async function isTabActive(name) {
  const tab = await findVisibleElement(tabContainerLocator(name));
  const className = await tab.getAttribute('class');
  return className.includes('bg-primary/10') || className.includes('border-primary/40');
}

async function login() {
  console.log('\n\x1b[1mLogging in...\x1b[0m');
  await driver.get(BASE_URL);

  await driver.wait(async () => {
    const hasEmailField = await elementExists(By.css('input[type="email"], input[name="email"]'));
    const hasPasskeyButton = await elementExists(By.css('button'));
    const isLoggedIn = await elementExists(By.css('[data-testid="main-layout"], nav, aside'));
    return hasEmailField || hasPasskeyButton || isLoggedIn;
  }, TIMEOUT);

  const currentUrl = await driver.getCurrentUrl();
  if (!currentUrl.includes('login') && !currentUrl.includes('auth')) {
    const isLoggedIn = await elementExists(By.css('[data-testid="main-layout"], nav, aside'));
    if (isLoggedIn) {
      console.log('  Already logged in, skipping login flow');
      return;
    }
  }

  const passwordToggle = await driver.findElements(
    By.xpath("//button[contains(., 'password') or contains(., 'Password') or contains(., 'email')]"),
  );
  if (passwordToggle.length > 0) {
    await passwordToggle[0].click();
    await sleep(500);
  }

  const emailInput = await waitVisible(By.css('input[type="email"], input[name="email"], input[name="identifier"]'));
  await emailInput.clear();
  await emailInput.sendKeys(LOGIN_EMAIL);

  const passwordInput = await waitVisible(By.css('input[type="password"], input[name="password"]'));
  await passwordInput.clear();
  await passwordInput.sendKeys(LOGIN_PASSWORD);

  const submitBtn = await driver.findElement(
    By.xpath("//button[@type='submit' or contains(., 'Sign in') or contains(., 'Log in')]"),
  );
  await submitBtn.click();

  await driver.wait(async () => {
    const url = await driver.getCurrentUrl();
    return !url.includes('login') && !url.includes('auth');
  }, TIMEOUT);

  await sleep(1500);
  console.log('  Logged in successfully');
}

async function testSshDuplicateTabs() {
  console.log('\n\x1b[1mTest: SSH duplicate tabs\x1b[0m');
  await openConnectionFromPalette(SSH_CONNECTION);
  await waitForVisibleCount(tabCloseButtonLocator(SSH_CONNECTION), 1);

  await openConnectionFromPalette(SSH_CONNECTION);
  await waitForVisibleCount(tabCloseButtonLocator(SSH_CONNECTION), 2);

  assert(await tabCloseCount(SSH_CONNECTION) === 2, 'Opening the same SSH connection twice creates two tabs');
}

async function testDatabaseDuplicateTabsAndToolbar() {
  console.log('\n\x1b[1mTest: Database duplicate tabs and toolbar\x1b[0m');
  await openConnectionFromPalette(DB_CONNECTION);
  await waitForVisibleCount(tabCloseButtonLocator(DB_CONNECTION), 1);

  await openConnectionFromPalette(DB_CONNECTION);
  await waitForVisibleCount(tabCloseButtonLocator(DB_CONNECTION), 2);

  assert(await tabCloseCount(DB_CONNECTION) === 2, 'Opening the same database connection twice creates two tabs');

  await clickVisible(tabButtonLocator(DB_CONNECTION));
  await waitVisible(By.css('button[aria-label="Session settings"]'));

  const visibleSessionSettingsButtons = await visibleElements(By.css('button[aria-label="Session settings"]'));
  assert(visibleSessionSettingsButtons.length === 1, 'Database session settings is exposed once in the visible docked toolbar');

  const visibleRunButtons = await visibleElements(By.css('button[aria-label="Run query (Ctrl+Enter)"]'));
  assert(visibleRunButtons.length === 1, 'Database run action is exposed once in the visible docked toolbar');

  const sessionSettingsButton = visibleSessionSettingsButtons[0];
  await sessionSettingsButton.click();
  await waitVisible(By.xpath("//*[contains(., 'Session Configuration')]"));

  const hasActiveDatabase = await elementExists(By.xpath("//label[contains(., 'Active Database')]"));
  assert(hasActiveDatabase, 'Session settings popover opens from the docked toolbar');

  await sessionSettingsButton.click();
  await sleep(300);
}

async function testRdpDedupAndFocus() {
  console.log('\n\x1b[1mTest: RDP dedupe and focus\x1b[0m');
  await openConnectionFromPalette(RDP_CONNECTION);
  await waitForVisibleCount(tabCloseButtonLocator(RDP_CONNECTION), 1);
  assert(await tabCloseCount(RDP_CONNECTION) === 1, 'Opening the RDP connection creates one tab');

  await clickVisible(tabButtonLocator(SSH_CONNECTION));
  await driver.wait(async () => isTabActive(SSH_CONNECTION), TIMEOUT);

  await openConnectionFromPalette(RDP_CONNECTION);

  await driver.wait(async () => {
    const count = await tabCloseCount(RDP_CONNECTION);
    const active = await isTabActive(RDP_CONNECTION);
    return count === 1 && active;
  }, TIMEOUT);

  assert(await tabCloseCount(RDP_CONNECTION) === 1, 'Opening the same RDP connection again does not create a second tab');
  assert(await isTabActive(RDP_CONNECTION), 'Reopening the same RDP connection focuses the existing tab');
}

async function main() {
  console.log(`\x1b[1m\x1b[36m╔══════════════════════════════════════════════════════════╗\x1b[0m`);
  console.log(`\x1b[1m\x1b[36m║   Arsenale — Workspace Session Behavior Selenium Test   ║\x1b[0m`);
  console.log(`\x1b[1m\x1b[36m╚══════════════════════════════════════════════════════════╝\x1b[0m`);
  console.log(`\n  Target: ${BASE_URL}\n`);

  const options = new chrome.Options();
  options.addArguments(
    '--headless=new',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--window-size=1440,900',
    '--ignore-certificate-errors',
    '--allow-insecure-localhost',
  );
  options.setChromeBinaryPath('/usr/bin/chromium');

  driver = await new Builder()
    .forBrowser('chrome')
    .setChromeOptions(options)
    .build();

  try {
    await login();
    await testSshDuplicateTabs();
    await testDatabaseDuplicateTabsAndToolbar();
    await testRdpDedupAndFocus();
  } catch (err) {
    failed += 1;
    console.error(`\n\x1b[31mUnexpected error:\x1b[0m`, err.message);

    try {
      const screenshot = await driver.takeScreenshot();
      const fs = await import('fs');
      const path = 'e2e/workspace-session-behavior.failure.png';
      fs.writeFileSync(path, screenshot, 'base64');
      console.log(`  Screenshot saved to ${path}`);
    } catch {
      // Ignore screenshot failures.
    }
  } finally {
    await driver.quit();
  }

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`  \x1b[32m${passed} passed\x1b[0m  \x1b[31m${failed} failed\x1b[0m  (${passed + failed} total)`);
  console.log(`${'─'.repeat(50)}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main();

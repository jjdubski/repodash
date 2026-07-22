/* ═════════════════════════════════════════════════════════════════════
   Insights Dashboard — End-to-End Tests
   ═════════════════════════════════════════════════════════════════════ */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// ── Paths ────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');
const CLI_ENTRY = join(PROJECT_ROOT, 'bin', 'repodash.js');

// ── Fixture state ────────────────────────────────────────────────────────

const FIXTURE_DIR = mkdtempSync(join(tmpdir(), 'repodash-e2e-'));
const REPO_PATH = join(FIXTURE_DIR, 'test-repo');
const SCREENSHOT_DIR = join(FIXTURE_DIR, 'screenshots');

/** @type {import('node:child_process').ChildProcess} */
let serverProcess;

/** @type {import('playwright').Browser} */
let browser;

/** @type {import('playwright').Page} */
let page;

/** @type {string} */
let dashboardUrl;

/** @type {string} */
let stderrOutput = '';

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Wait for the server to print the dashboard URL.
 * Resolves once the URL line is seen on stdout.
 */
function waitForUrl(proc, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => {
      proc.stdout?.removeAllListeners('data');
      reject(new Error(`Timed out waiting for dashboard URL.\nCaptured stdout:\n${buf}`));
    }, timeoutMs);

    const onData = (chunk) => {
      buf += chunk.toString();
      const match = buf.match(/http:\/\/localhost:\d+/);
      if (match) {
        clearTimeout(timer);
        proc.stdout?.removeAllListeners('data');
        proc.stderr?.removeAllListeners('data');
        resolve(match[0]);
      }
    };

    proc.stdout?.on('data', onData);

    let stderrBuf = '';
    proc.stderr?.on('data', (chunk) => {
      stderrBuf += chunk.toString();
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    proc.on('exit', (code) => {
      if (code !== 0) {
        clearTimeout(timer);
        reject(
          new Error(`Server exited with code ${code}.\nstderr:\n${stderrBuf}\nstdout:\n${buf}`)
        );
      }
    });
  });
}

/**
 * Take a screenshot named after the current test.
 */
async function screenshot(name) {
  if (!page) return;
  const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100);
  await page.screenshot({
    path: join(SCREENSHOT_DIR, `${safeName}.png`),
    fullPage: true
  });
}

// ── Fixture setup / teardown ─────────────────────────────────────────────

before(async () => {
  // Create a small predictable git repo with 2 authors
  mkdirSync(REPO_PATH, { recursive: true });

  execSync(`git init "${REPO_PATH}"`, { stdio: 'pipe' });
  execSync('git config user.name "Test User"', { cwd: REPO_PATH, stdio: 'pipe' });
  execSync('git config user.email "test@example.com"', {
    cwd: REPO_PATH,
    stdio: 'pipe'
  });

  // Commit 1 — single file
  writeFileSync(join(REPO_PATH, 'file1.txt'), 'hello\n');
  execSync('git add file1.txt && git commit -m "Initial commit"', {
    cwd: REPO_PATH,
    stdio: 'pipe'
  });

  // Commit 2 — modify + new file
  appendFileSync(join(REPO_PATH, 'file1.txt'), 'world\n');
  writeFileSync(join(REPO_PATH, 'file2.txt'), 'feature a\n');
  execSync('git add file1.txt file2.txt && git commit -m "Add feature A"', {
    cwd: REPO_PATH,
    stdio: 'pipe'
  });

  // Commit 3 — second author
  writeFileSync(join(REPO_PATH, 'file3.txt'), 'feature b\n');
  execSync(
    'git add file3.txt && git commit -m "Add feature B" --author="Developer2 <dev2@example.com>"',
    { cwd: REPO_PATH, stdio: 'pipe' }
  );

  // Prepare screenshot directory
  mkdirSync(SCREENSHOT_DIR, { recursive: true });

  // Start the repodash CLI with --timing to verify timeline output
  serverProcess = spawn('node', [CLI_ENTRY, REPO_PATH, '--timing'], {
    cwd: PROJECT_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, REPODASH_DISABLE_OPEN: '1' }
  });

  serverProcess.stderr?.on('data', (chunk) => {
    stderrOutput += chunk.toString();
  });

  // Capture any unexpected server exit
  serverProcess.on('exit', (code) => {
    if (code !== null && dashboardUrl === undefined) {
      throw new Error(`Server exited unexpectedly with code ${code}`);
    }
  });

  // Wait for dashboard URL from the server process
  dashboardUrl = await waitForUrl(serverProcess);

  // Launch Playwright browser
  browser = await chromium.launch();

  // Create a new context with a realistic viewport
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 }
  });

  page = await context.newPage();

  // Navigate to the dashboard and wait for it to be fully loaded
  await page.goto(dashboardUrl, { waitUntil: 'networkidle' });
});

after(async () => {
  // Kill the server process
  if (serverProcess && !serverProcess.killed) {
    try {
      serverProcess.kill('SIGTERM');
    } catch {
      // already dead
    }
  }

  // Close the browser
  if (browser) {
    try {
      await browser.close();
    } catch {
      // already closed
    }
  }

  // Remove fixture directory (including screenshots and repo)
  try {
    rmSync(FIXTURE_DIR, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
});

// ═════════════════════════════════════════════════════════════════════════
//  Tests
// ═════════════════════════════════════════════════════════════════════════

describe('Dashboard E2E', () => {
  // ── 1. Dashboard title ──────────────────────────────────────────────────

  it('should display the dashboard title', async () => {
    const title = await page.textContent('.header-title');
    assert.equal(title, 'Insights');
  });

  // ── 2. Timing flag output ───────────────────────────────────────────────

  it('should emit timing breakdown to stderr with --timing flag', () => {
    // Timing output shows per-phase lines: "  Parse commits (2026)   0.26s\n"
    assert.ok(stderrOutput.includes('Parse commits'), 'stderr should contain parse timing');
    assert.ok(stderrOutput.includes('Total'), 'stderr should contain total timing line');
    assert.ok(/[\d.]+s/.test(stderrOutput), 'stderr should contain timing values in seconds');
  });

  // ── 3. Five datasets present ────────────────────────────────────────────

  it('should load summary metrics with real values (not placeholders)', async () => {
    // Wait for the metric cards to have numeric values (not em-dash)
    await page.waitForFunction(
      () => {
        const commits = document.getElementById('metric-commits');
        const contributors = document.getElementById('metric-contributors');
        const additions = document.getElementById('metric-additions');
        const deletions = document.getElementById('metric-deletions');
        if (!commits || !contributors || !additions || !deletions) return false;
        // All four should have values other than the em-dash placeholder
        return (
          commits.textContent !== '\u2014' &&
          contributors.textContent !== '\u2014' &&
          additions.textContent !== '\u2014' &&
          deletions.textContent !== '\u2014'
        );
      },
      { timeout: 15000 }
    );

    const commits = await page.textContent('#metric-commits');
    const contributors = await page.textContent('#metric-contributors');
    const additions = await page.textContent('#metric-additions');
    const deletions = await page.textContent('#metric-deletions');

    // Validate expected values
    assert.equal(commits, '3', 'Total Commits should be 3');
    assert.equal(contributors, '2', 'Contributors should be 2');
    assert.match(additions, /^\d+$/, 'Additions should be a number');
    assert.match(deletions, /^\d+$/, 'Deletions should be a number');

    await screenshot('summary-metrics');
  });

  it('should have contribution chart canvas on the overview tab', async () => {
    const canvas = await page.$('#chart-contribution');
    assert.ok(canvas, 'Contribution chart canvas should exist');
  });

  it('should have top contributors chart canvas on the overview tab', async () => {
    const canvas = await page.$('#chart-top-contributors');
    assert.ok(canvas, 'Top contributors chart canvas should exist');
  });

  it('should have frequency overview chart canvas on the overview tab', async () => {
    const canvas = await page.$('#chart-frequency-overview');
    assert.ok(canvas, 'Frequency overview chart canvas should exist');
  });

  it('should have the contribution mode dropdown on overview', async () => {
    const select = await page.$('#contribution-mode');
    assert.ok(select, 'Contribution mode select should exist');

    const options = await page.evaluate(() =>
      Array.from(document.querySelectorAll('#contribution-mode option')).map((el) => el.value)
    );
    assert.deepEqual(options, ['author', 'commits']);
  });

  // ── 4. Tab switching ───────────────────────────────────────────────────

  it('should switch to Contributors tab on click', async () => {
    await page.click('#tab-contributors-label');

    // Wait for the contributors tab content to become active
    await page.waitForFunction(
      () => {
        const panel = document.getElementById('tab-contributors');
        return panel?.classList.contains('active');
      },
      { timeout: 10000 }
    );

    // Wait for the table to populate with data rows (worker renders asynchronously)
    await page.waitForFunction(
      () => {
        const tbody = document.querySelector('#contributors-table tbody');
        return tbody && tbody.children.length > 0;
      },
      { timeout: 15000 }
    );

    // Verify contributor names appear in the table
    const tableBody = await page.textContent('#contributors-table tbody');
    assert.ok(
      tableBody.includes('Test User') || tableBody.includes('Developer2'),
      'Contributors table should contain at least one known author name'
    );

    await screenshot('contributors-tab');
  });

  it('should switch to Activity tab on click', async () => {
    await page.click('#tab-activity-label');

    await page.waitForFunction(
      () => {
        const panel = document.getElementById('tab-activity');
        return panel?.classList.contains('active');
      },
      { timeout: 10000 }
    );

    // Activity tab has charts: day-of-week and hour
    const dayOfWeek = await page.$('#chart-dayofweek');
    const hour = await page.$('#chart-hour');
    assert.ok(dayOfWeek, 'Day-of-week chart canvas should exist on Activity tab');
    assert.ok(hour, 'Hour chart canvas should exist on Activity tab');

    // Verify top files table
    const filesTable = await page.$('#topfiles-table');
    assert.ok(filesTable, 'Top files table should exist on Activity tab');

    await screenshot('activity-tab');
  });

  it('should switch back to Overview tab via hash', async () => {
    await page.click('#tab-overview-label');

    await page.waitForFunction(
      () => {
        const panel = document.getElementById('tab-overview');
        return panel?.classList.contains('active');
      },
      { timeout: 10000 }
    );

    const overviewActive = await page.evaluate(() =>
      document.getElementById('tab-overview')?.classList.contains('active')
    );
    assert.equal(overviewActive, true, 'Overview tab should be active');

    await screenshot('overview-tab-again');
  });

  // ── 5. Time filter pills ───────────────────────────────────────────────

  it('should display time filter pills', async () => {
    const pills = await page.$$('.time-filter .pill');
    assert.equal(pills.length, 5, 'There should be 5 time filter pills');

    const pillTexts = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.time-filter .pill')).map((el) => el.textContent)
    );

    assert.deepEqual(pillTexts, ['All Time', 'Past Year', 'Last 3 Months', 'This Week', 'Custom']);

    await screenshot('time-filter-pills');
  });

  it('should highlight clicked time filter pill', async () => {
    // "All Time" should not be active initially (default is "Last 3 Months")
    // Click "All Time"
    await page.click('.pill[data-filter="allTime"]');

    await page.waitForFunction(
      () => document.querySelector('.pill[data-filter="allTime"]')?.classList.contains('active'),
      { timeout: 5000 }
    );

    const allTimeActive = await page.evaluate(() =>
      document.querySelector('.pill[data-filter="allTime"]')?.classList.contains('active')
    );
    assert.equal(allTimeActive, true, 'All Time pill should be active after click');

    const last3mActive = await page.evaluate(() =>
      document.querySelector('.pill[data-filter="last3months"]')?.classList.contains('active')
    );
    assert.equal(last3mActive, false, 'Last 3 Months pill should no longer be active');
  });

  it('should restore default filter after switching back', async () => {
    // Click "Last 3 Months" to restore
    await page.click('.pill[data-filter="last3months"]');

    await page.waitForFunction(
      () =>
        document.querySelector('.pill[data-filter="last3months"]')?.classList.contains('active'),
      { timeout: 5000 }
    );

    const last3mActive = await page.evaluate(() =>
      document.querySelector('.pill[data-filter="last3months"]')?.classList.contains('active')
    );
    assert.equal(last3mActive, true, 'Last 3 Months pill should be active');
  });

  // ── 6. PDF Export button ────────────────────────────────────────────────

  it('should display the PDF export button', async () => {
    const exportBtn = await page.$('#export-pdf');
    assert.ok(exportBtn, 'PDF export button should exist');

    const btnText = await page.textContent('#export-pdf');
    assert.ok(btnText.includes('Export PDF'), 'Button should contain "Export PDF" text');

    await screenshot('export-pdf-button');
  });

  it('should show export overlay when PDF button is clicked', async () => {
    await page.click('#export-pdf');

    await page.waitForSelector('#export-overlay:not(.hidden)', { timeout: 5000 });

    const exportBtn = await page.$('#export-pdf');
    assert.ok(exportBtn, 'Export button should still exist after click');

    await screenshot('after-pdf-click');
  });

  // ── 7. Theme toggle ────────────────────────────────────────────────────

  it('should toggle theme on button click', async () => {
    const initialTheme = await page.evaluate(() => document.documentElement.dataset.theme);

    await page.click('#theme-toggle');

    const newTheme = await page.evaluate(() => document.documentElement.dataset.theme);

    assert.notEqual(
      newTheme,
      initialTheme,
      `Theme should toggle from ${initialTheme} to ${newTheme}`
    );

    // Toggle back to light
    await page.click('#theme-toggle');
    const restoredTheme = await page.evaluate(() => document.documentElement.dataset.theme);
    assert.equal(restoredTheme, initialTheme, 'Theme should be restored after second toggle');

    await screenshot('theme-toggle');
  });

  // ── 8. Language Breakdown ───────────────────────────────────────────

  it('should display language breakdown doughnut chart on overview', async () => {
    await page.click('#tab-overview-label');
    await page.waitForFunction(
      () => document.getElementById('tab-overview')?.classList.contains('active'),
      { timeout: 5000 }
    );

    const canvas = await page.$('#chart-languages');
    assert.ok(canvas, 'Language doughnut chart canvas should exist');
  });

  it('should populate language table with rows', async () => {
    await page.waitForFunction(
      () => {
        const tbody = document.querySelector('#languages-table tbody');
        return tbody && tbody.children.length > 0;
      },
      { timeout: 10000 }
    );

    const rows = await page.evaluate(
      () => document.querySelectorAll('#languages-table tbody tr').length
    );
    assert.ok(rows > 0, 'Language table should have at least one row');

    const tableText = await page.textContent('#languages-table tbody');
    assert.ok(tableText.length > 0, 'Language table should have content');

    await screenshot('language-breakdown');
  });

  it('should preserve language chart after tab switch', async () => {
    await page.click('#tab-contributors-label');
    await page.waitForFunction(
      () => document.getElementById('tab-contributors')?.classList.contains('active'),
      { timeout: 5000 }
    );

    await page.click('#tab-overview-label');
    await page.waitForFunction(
      () => document.getElementById('tab-overview')?.classList.contains('active'),
      { timeout: 5000 }
    );

    const canvas = await page.$('#chart-languages');
    assert.ok(canvas, 'Language chart should still exist after tab switch');
  });

  // ── 9. Contribution graph on Activity tab ──────────────────────────

  it('should render contribution graph grid on activity tab', async () => {
    await page.click('#tab-activity-label');
    await page.waitForFunction(
      () => document.getElementById('tab-activity')?.classList.contains('active'),
      { timeout: 5000 }
    );

    await page.waitForFunction(
      () => {
        const grid = document.getElementById('contribgraph-grid');
        return grid && grid.children.length > 0;
      },
      { timeout: 10000 }
    );

    const grid = await page.$('#contribgraph-grid');
    assert.ok(grid, 'Contribution graph grid should exist');

    await screenshot('contribution-graph');
  });

  it('should populate contributor dropdown on activity tab', async () => {
    await page.waitForFunction(
      () => {
        const select = document.getElementById('contribgraph-author');
        return select && select.options.length > 1;
      },
      { timeout: 10000 }
    );

    const options = await page.evaluate(() =>
      Array.from(document.querySelectorAll('#contribgraph-author option')).map((el) => el.text)
    );
    assert.ok(options.length > 0, 'Contributor dropdown should have options');
  });

  // ── 10. Dark theme persistence ─────────────────────────────────────

  it('should persist dark theme across page reload', async () => {
    await page.evaluate(() => localStorage.setItem('repodash-theme', 'dark'));
    await page.reload({ waitUntil: 'networkidle' });

    const theme = await page.evaluate(() => document.documentElement.dataset.theme);
    assert.equal(theme, 'dark', 'Theme should be dark after reload when localStorage says dark');
  });

  // ── 11. Responsive layout ──────────────────────────────────────────

  it('should render metric grid as single column on mobile viewport', async () => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForTimeout(500);

    const columns = await page.evaluate(
      () => getComputedStyle(document.querySelector('.metric-grid')).gridTemplateColumns
    );
    assert.equal(columns, '1fr', 'Metric grid should be single column on mobile');
  });

  it('should show header on mobile viewport', async () => {
    const header = await page.$('.header-title');
    assert.ok(header, 'Header should be visible on mobile');

    const isVisible = await page.evaluate(
      () => getComputedStyle(document.querySelector('.header')).display !== 'none'
    );
    assert.equal(isVisible, true, 'Header should not be hidden on mobile');
  });
});

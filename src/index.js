import chalk from 'chalk';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, rmSync, statSync, mkdtempSync, readdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import open from 'open';
import { getLocalBranchCount, cloneRemoteRepo } from './git.js';
import { aggregateStreamParallel } from './aggregate.js';
import { serveDashboard } from './server.js';
import { tmpdir } from 'node:os';

/** @type {string[]} */
const tempDirs = [];

// Clean up stale temp dirs from previous runs that weren't cleaned up
// (e.g., SIGKILL, power loss, npx killing the child process).
// Only clean dirs older than 5 minutes to avoid interfering with concurrent runs.
// Skip test fixtures (insights-test-*) and clone dirs (insights-clone-*).
const STALE_PREFIX = 'insights-';
try {
  const entries = readdirSync(tmpdir());
  const cutoff = Date.now() - 5 * 60 * 1000;
  for (const entry of entries) {
    if (!entry.startsWith(STALE_PREFIX)) continue;
    const fullPath = join(tmpdir(), entry);
    try {
      const stat = statSync(fullPath);
      if (!stat.isDirectory()) continue;
      if (stat.mtimeMs > cutoff) continue;
      rmSync(fullPath, { recursive: true, force: true });
    } catch {
      void 0;
    }
  }
} catch {
  void 0;
}

function cleanupSync() {
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      void 0;
    }
  }
  tempDirs.length = 0;
}

process.on('exit', cleanupSync);

export async function main(repoPath, options = {}) {
  let actualRepoPath = repoPath;
  let isCloned = false;

  if (repoPath && /^[a-z+]+:\/\//.test(repoPath)) {
    const tempDir = mkdtempSync(join(tmpdir(), 'insights-clone-'));
    tempDirs.push(tempDir);
    await cloneRemoteRepo(repoPath, options.token, tempDir);
    actualRepoPath = tempDir;
    isCloned = true;
  }

  console.error(chalk.cyan(`insights: scanning repo at ${actualRepoPath}`));

  const totalStart = performance.now();

  if (options.timing) console.error();

  const timings = [];
  const result = await aggregateStreamParallel(
    actualRepoPath,
    getLocalBranchCount(actualRepoPath),
    timings,
    options.timing
      ? (label, elapsed) => console.error(`  ${label.padEnd(22)} ${elapsed.toFixed(2)}s`)
      : undefined,
    { noMerges: options['no-merges'], concurrency: options.concurrency }
  );

  let repoName;
  if (isCloned) {
    repoName = repoPath
      .split('/')
      .pop()
      .replace(/\.git$/, '')
      .replace(/[/\\]$/, '');
  } else {
    repoName = actualRepoPath
      .replace(/[/\\]$/, '')
      .split(/[/\\]/)
      .pop()
      .replace(/\.git$/, '');
  }
  result.summary.repoName = repoName;

  const genStart = performance.now();

  let dashboardUrl;

  if (options.json) {
    const filtered = filterDatasets(result, options);
    console.log(JSON.stringify(filtered, null, 2));
  } else if (options.file) {
    const filtered = filterDatasets(result, options);
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    let filePath;
    if (typeof options.file === 'string') {
      filePath = options.file.replace(/[/\\]+$/, '');
      if (existsSync(filePath) && statSync(filePath).isDirectory()) {
        filePath = join(filePath, `insights_${ts}.json`);
      }
    } else {
      filePath = join(actualRepoPath, `insights_${ts}.json`);
    }
    await writeFile(filePath, JSON.stringify(filtered, null, 2));
    console.error(chalk.green(`✓ Written to ${filePath}`));
  } else if (options.pdf) {
    if (dirname(options.pdf) && !existsSync(dirname(options.pdf))) {
      throw new Error(`Parent directory does not exist: ${dirname(options.pdf)}`);
    }

    const { chromium } = await import('playwright');
    const executablePath = chromium.executablePath();
    if (!existsSync(executablePath)) {
      throw new Error(
        `Playwright Chromium binary not found at ${executablePath}. Run "npx playwright install chromium".`
      );
    }

    const dashboardDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'dashboard');
    const { port, tmpDir, server } = await serveDashboard(result, dashboardDir);
    tempDirs.push(tmpDir);

    const addr = `http://localhost:${port}`;
    console.error(chalk.cyan(`insights: generating PDF from dashboard at ${addr}`));

    try {
      const browser = await chromium.launch({ args: ['--no-sandbox'] });
      const page = await browser.newPage();
      await page.goto(addr, { waitUntil: 'networkidle' });
      await page.pdf({ path: options.pdf, format: 'A4' });
      await browser.close();
      console.error(chalk.green(`✓ Written to ${options.pdf}`));
    } catch (err) {
      throw new Error(`Failed to generate PDF: ${err.message}`, { cause: err });
    } finally {
      server.close();
      cleanupSync();
    }
  } else {
    const dashboardDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'dashboard');
    const { port, tmpDir, server } = await serveDashboard(result, dashboardDir);
    void server;
    tempDirs.push(tmpDir);

    const addr = `http://localhost:${port}`;
    dashboardUrl = addr;

    const openBrowser = options.openBrowser ?? open;
    openBrowser(addr).catch((err) => {
      console.warn(chalk.yellow(`Could not open browser: ${err.message}`));
      console.warn(chalk.yellow(`Open ${addr} manually.`));
    });

    let shuttingDown = false;

    const cleanup = () => {
      if (shuttingDown) return;
      shuttingDown = true;
      cleanupSync();
      tempDirs.length = 0;
      process.exit(0);
    };

    process.once('SIGINT', cleanup);
    process.once('SIGTERM', cleanup);
    process.once('SIGHUP', cleanup);
    process.stdin.on('close', cleanup);
  }

  if (options.timing) {
    const genElapsed = (performance.now() - genStart) / 1000;
    console.error(`  ${'Generate output'.padEnd(22)} ${genElapsed.toFixed(2)}s`);
    console.error(`  ${'─'.repeat(27)}`);
    console.error(
      `  ${'Total'.padEnd(22)} ${((performance.now() - totalStart) / 1000).toFixed(2)}s`
    );
  }

  if (dashboardUrl) {
    console.log();
    console.log(chalk.cyan('📊 insights dashboard:'), chalk.underline(dashboardUrl));
  }
}

function filterDatasets(result, options) {
  const filterFlags = ['summary', 'contributions', 'contributors', 'frequency', 'activity'];
  const hasAnyFilter = filterFlags.some((f) => options[f]);

  if (!hasAnyFilter) return result;

  const filtered = {};
  for (const key of filterFlags) {
    if (options[key]) {
      filtered[key] = result[key];
    }
  }
  return filtered;
}

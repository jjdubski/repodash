import chalk from 'chalk';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, rmSync, statSync, mkdtempSync, readdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import open from 'open';
import { getLocalBranchCount, cloneRemoteRepo } from './git.js';
import { aggregateStreamParallel } from './aggregate.js';
import { serveDashboard } from './server.js';
import { toCSV } from './csv.js';
import { tmpdir } from 'node:os';

/** @type {string[]} */
const tempDirs = [];

// Clean up stale temp dirs from previous runs that weren't cleaned up
// (e.g., SIGKILL, power loss, npx killing the child process).
// Only clean dirs older than 5 minutes to avoid interfering with concurrent runs.
// Skip test fixtures (repodash-test-*) and clone dirs (repodash-clone-*).
const STALE_PREFIX = 'repodash-';
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

/**
 * Set up shutdown handlers to clean up resources
 * @param {() => void} cleanupFn - Function to call on shutdown
 */
export function setupShutdownHandlers(cleanupFn) {
  let shuttingDown = false;

  const cleanup = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    cleanupFn();
    process.exit(0);
  };

  process.once('SIGINT', cleanup);
  process.once('SIGTERM', cleanup);
  process.once('SIGHUP', cleanup);
  process.stdin.on('close', cleanup);
}

/**
 * Main function that orchestrates the insights generation process.
 *
 * @param {string} repoPath - Path to the git repository or URL of a remote repository
 * @param {object} [options={}] - Configuration options
 * @param {string} [options.token] - Authentication token for private repositories
 * @param {boolean} [options['no-merges']] - If true, exclude merge commits
 * @param {number} [options.concurrency] - Max parallel workers for processing
 * @param {boolean} [options.timing] - If true, show timing information
 * @param {boolean} [options.json] - If true, output JSON to stdout instead of starting server
 * @param {string|boolean} [options.file] - If provided, write JSON to file (or current directory if true)
 * @param {string} [options.csv] - If provided, generate CSV report to this file path
 * @param {string} [options.pdf] - If provided, generate PDF report to this file path
 * @param {Function|false} [options.openBrowser] - Custom browser-open function (defaults to the 'open' package). Pass false to suppress automatic browser opening.
 * @returns {Promise<void>} Promise that resolves when the process completes
 */
export async function main(repoPath, options = {}) {
  let actualRepoPath = repoPath;
  let isCloned = false;

  if (repoPath && /^[a-z+]+:\/\//.test(repoPath)) {
    const tempDir = mkdtempSync(join(tmpdir(), 'repodash-clone-'));
    tempDirs.push(tempDir);
    await cloneRemoteRepo(repoPath, options.token, tempDir);
    actualRepoPath = tempDir;
    isCloned = true;
  }

  console.error(chalk.cyan(`repodash: scanning repo at ${actualRepoPath}`));

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
        filePath = join(filePath, `repodash_${ts}.json`);
      }
    } else {
      filePath = join(actualRepoPath, `repodash_${ts}.json`);
    }
    await writeFile(filePath, JSON.stringify(filtered, null, 2));
    console.error(chalk.green(`✓ Written to ${filePath}`));
  } else if (options.csv) {
    const csvPath = options.csv;
    if (dirname(csvPath) && !existsSync(dirname(csvPath))) {
      throw new Error(`parent directory does not exist: ${dirname(csvPath)}`);
    }
    const filtered = filterDatasets(result, options);
    const csvContent = toCSV(filtered);
    await writeFile(csvPath, csvContent, 'utf-8');
    console.error(chalk.green(`✓ Written to ${csvPath}`));
  } else if (options.pdf) {
    if (dirname(options.pdf) && !existsSync(dirname(options.pdf))) {
      throw new Error(`parent directory does not exist: ${dirname(options.pdf)}`);
    }

    let chromium;
    try {
      chromium = (await import('playwright')).chromium;
    } catch {
      throw new Error(
        'Playwright is not installed. Run "npx playwright install chromium" to use the --pdf flag.'
      );
    }
    const executablePath = chromium.executablePath();
    if (!existsSync(executablePath)) {
      throw new Error(
        `playwright chromium binary not found at ${executablePath}. Run "npx playwright install chromium".`
      );
    }

    const dashboardDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'dashboard');
    const { port, tmpDir, server } = await serveDashboard(result, dashboardDir);
    tempDirs.push(tmpDir);

    const addr = `http://localhost:${port}`;
    console.error(chalk.cyan(`repodash: generating PDF from dashboard at ${addr}`));

    const pdfCleanup = () => {
      try {
        server.close();
      } catch {
        void 0;
      }
      cleanupSync();
    };
    setupShutdownHandlers(pdfCleanup);

    try {
      const browser = await chromium.launch({ args: ['--no-sandbox'] });
      const page = await browser.newPage();
      await page.goto(addr, { waitUntil: 'networkidle' });
      await page.pdf({ path: options.pdf, format: 'A4' });
      await browser.close();
      console.error(chalk.green(`✓ Written to ${options.pdf}`));
    } catch (err) {
      throw new Error(`failed to generate pdf: ${err.message}`, { cause: err });
    } finally {
      server.close();
      cleanupSync();
    }
  } else {
    const dashboardDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'dashboard');
    const { port, tmpDir, server } = await serveDashboard(result, dashboardDir);
    tempDirs.push(tmpDir);

    const addr = `http://localhost:${port}`;
    dashboardUrl = addr;

    const openBrowser = process.env.REPODASH_DISABLE_OPEN ? false : (options.openBrowser ?? open);
    if (openBrowser) {
      openBrowser(addr).catch((err) => {
        console.warn(chalk.yellow(`Could not open browser: ${err.message}`));
        console.warn(chalk.yellow(`Open ${addr} manually.`));
      });
    }

    const dashboardCleanup = () => {
      try {
        server.close();
      } catch {
        void 0;
      }
      cleanupSync();
    };
    setupShutdownHandlers(dashboardCleanup);
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
    console.log(chalk.cyan('📊 repodash dashboard:'), chalk.underline(dashboardUrl));
  }
}

/**
 * Filters datasets based on provided options.
 *
 * @param {object} result - The full result object from aggregation
 * @param {object} options - Configuration options for filtering
 * @returns {object} Filtered result object containing only requested datasets
 */
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

import chalk from 'chalk';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, rmSync, statSync, mkdtempSync, readdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import open from 'open';
import { getLocalBranchCount, cloneRemoteRepo, getRemoteUrl } from './git.js';
import { fetchUserRepos } from './github.js';
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
 * Creates a copy of a result object without repoData/repos to avoid circular references.
 *
 * @param {object} result - The result object to strip
 * @returns {object} A clean copy without repoData and repos
 */
function stripRepoData(result) {
  const copy = { ...result };
  delete copy.repoData;
  delete copy.repos;
  return copy;
}

/**
 * Resolves a repo name from a local path, falling back to git remote origin.
 *
 * @param {string} repoPath - Path to the git repository
 * @returns {Promise<string|null>} The resolved repo name or null
 */
async function getRepoName(repoPath) {
  const name = extractRepoName(repoPath);
  if (name && name !== '.') return name;
  const remoteUrl = await getRemoteUrl(repoPath).catch(() => null);
  if (remoteUrl) return extractRepoName(remoteUrl);
  return null;
}

/**
 * Extracts a human-readable repo name from a git URL or local path.
 *
 * @param {string} urlOrPath - A git URL (https://, git@, etc.) or local path
 * @returns {string} The extracted repo name
 */
function extractRepoName(urlOrPath) {
  // Remote URL: extract the last path segment before .git
  if (/^[a-z+]+:\/\//.test(urlOrPath) || urlOrPath.includes('@')) {
    return urlOrPath
      .replace(/\/$/, '')
      .split('/')
      .pop()
      .replace(/\.git$/, '');
  }
  // Local path: extract the directory name
  return urlOrPath
    .replace(/[/\\]$/, '')
    .split(/[/\\]/)
    .pop()
    .replace(/\.git$/, '');
}

/**
 * Runs aggregation on a single repo path, returning the result + repo name.
 *
 * @param {string} repoPath - Path or URL to a git repository
 * @param {object} options - Options bag (token, noMerges, concurrency, timing, etc.)
 * @param {Array} timings - Shared timings array
 * @param {string} [explicitName] - Optional explicit repo name (used for cloned repos)
 * @returns {Promise<{result: object, repoName: string}>}
 */
async function aggregateSingleRepo(repoPath, options, timings, explicitName) {
  const result = await aggregateStreamParallel(
    repoPath,
    getLocalBranchCount(repoPath),
    timings,
    options.timing
      ? (label, elapsed) => console.error(`  ${label.padEnd(22)} ${elapsed.toFixed(2)}s`)
      : undefined,
    { noMerges: options['no-merges'], concurrency: options.concurrency }
  );

  const repoName = explicitName ?? (await getRepoName(repoPath));
  result.summary.repoName = repoName;
  return { result, repoName };
}

/**
 * Merges multiple aggregated results into a single combined result.
 *
 * @param {Array<{repoName: string, result: object}>} results - Array of per-repo results
 * @returns {object} Merged result
 */
function mergeAggregatedResults(results) {
  if (results.length === 0) throw new Error('no results to merge');
  if (results.length === 1) {
    const single = results[0].result;
    single.repos = [
      {
        name: results[0].repoName,
        fullName: results[0].result.summary.repoName || results[0].repoName,
        pushedAt: null
      }
    ];
    single.repoData = {};
    return single;
  }

  const merged = {
    contributions: [],
    contributors: [],
    frequency: [],
    languages: [],
    activity: {
      byDayOfWeek: [],
      byHour: [],
      topFiles: []
    },
    repos: [],
    repoData: {}
  };

  const contributionsByDate = new Map();
  const contributorsByEmail = new Map();
  const frequencyByDate = new Map();
  const languagesByLang = new Map();
  const dayOfWeekCounts = [0, 0, 0, 0, 0, 0, 0];
  const hourCounts = new Array(24).fill(0);

  const DAY_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  for (const { repoName, result } of results) {
    merged.repos.push({
      name: repoName,
      fullName: result.summary.repoName || repoName,
      pushedAt: null
    });
    merged.repoData[repoName] = stripRepoData(result);
  }

  for (const { repoName, result } of results) {
    for (const day of result.contributions) {
      const existing = contributionsByDate.get(day.date);
      if (existing) {
        existing.count += day.count;
        for (const h of day.byHour) {
          const slot = existing.byHour.find((b) => b.hour === h.hour);
          if (slot) slot.count += h.count;
        }
        for (const ad of day.authorDetails) {
          const existingAd = existing.authorDetails.find((e) => e.email === ad.email);
          if (existingAd) {
            existingAd.count += ad.count;
            existingAd.additions += ad.additions;
            existingAd.deletions += ad.deletions;
          } else {
            existing.authorDetails.push({ ...ad });
          }
        }
        for (const tf of day.topFiles || []) {
          const existingTf = existing.topFiles.find((e) => e.path === tf.path);
          if (existingTf) {
            existingTf.changes += tf.changes;
          } else {
            existing.topFiles.push({ ...tf });
          }
        }
      } else {
        contributionsByDate.set(day.date, {
          date: day.date,
          count: day.count,
          byHour: day.byHour.map((h) => ({ ...h })),
          authorDetails: day.authorDetails.map((a) => ({ ...a })),
          topFiles: (day.topFiles || []).map((f) => ({ ...f }))
        });
      }
    }

    for (const c of result.contributors) {
      const existing = contributorsByEmail.get(c.email);
      if (existing) {
        existing.totalCommits += c.totalCommits;
        existing.additions += c.additions;
        existing.deletions += c.deletions;
        if (c.firstCommit && (!existing.firstCommit || c.firstCommit < existing.firstCommit)) {
          existing.firstCommit = c.firstCommit;
        }
        if (c.lastCommit && (!existing.lastCommit || c.lastCommit > existing.lastCommit)) {
          existing.lastCommit = c.lastCommit;
        }
      } else {
        contributorsByEmail.set(c.email, { ...c });
      }
    }

    for (const f of result.frequency) {
      const existing = frequencyByDate.get(f.date);
      if (existing) {
        existing.additions += f.additions;
        existing.deletions += f.deletions;
      } else {
        frequencyByDate.set(f.date, { ...f });
      }
    }

    for (const l of result.languages) {
      const existing = languagesByLang.get(l.language);
      if (existing) {
        existing.files += l.files;
        existing.linesChanged += l.linesChanged;
      } else {
        languagesByLang.set(l.language, { ...l });
      }
    }

    if (result.activity) {
      for (let i = 0; i < 7 && i < result.activity.byDayOfWeek.length; i++) {
        dayOfWeekCounts[i] += result.activity.byDayOfWeek[i].count;
      }
      for (let i = 0; i < 24 && i < result.activity.byHour.length; i++) {
        hourCounts[i] += result.activity.byHour[i].count;
      }
    }
  }

  merged.contributions = Array.from(contributionsByDate.entries())
    .map(([date, day]) => {
      day.byHour.sort((a, b) => a.hour - b.hour);
      day.authorDetails.sort((a, b) => b.count - a.count || a.author.localeCompare(b.author));
      day.topFiles.sort((a, b) => b.changes - a.changes || a.path.localeCompare(b.path));
      return day;
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  merged.contributors = Array.from(contributorsByEmail.entries())
    .map(([, c]) => c)
    .sort((a, b) => b.totalCommits - a.totalCommits || a.name.localeCompare(b.name));

  merged.frequency = Array.from(frequencyByDate.entries())
    .map(([, f]) => f)
    .sort((a, b) => a.date.localeCompare(b.date));

  merged.languages = Array.from(languagesByLang.entries())
    .map(([, l]) => l)
    .sort(
      (a, b) =>
        b.files - a.files || b.linesChanged - a.linesChanged || a.language.localeCompare(b.language)
    );

  const otherIdx = merged.languages.findIndex((l) => l.language === 'Other');
  if (otherIdx !== -1) {
    merged.languages.push(merged.languages.splice(otherIdx, 1)[0]);
  }

  merged.activity = {
    byDayOfWeek: DAY_ORDER.map((day, i) => ({ day, count: dayOfWeekCounts[i] })),
    byHour: hourCounts.map((count, hour) => ({ hour, count })),
    topFiles: []
  };

  const fileChangeCounts = new Map();
  for (const { result } of results) {
    for (const tf of result.activity?.topFiles || []) {
      fileChangeCounts.set(tf.path, (fileChangeCounts.get(tf.path) || 0) + tf.changes);
    }
  }
  merged.activity.topFiles = Array.from(fileChangeCounts.entries())
    .map(([path, changes]) => ({ path, changes }))
    .sort((a, b) => b.changes - a.changes || a.path.localeCompare(b.path))
    .slice(0, 30);

  let totalCommits = 0;
  let totalAdditions = 0;
  let totalDeletions = 0;
  let firstCommit = null;
  let lastCommit = null;
  for (const { result } of results) {
    totalCommits += result.summary.totalCommits;
    totalAdditions += result.summary.totalAdditions;
    totalDeletions += result.summary.totalDeletions;
    if (result.summary.firstCommit && (!firstCommit || result.summary.firstCommit < firstCommit)) {
      firstCommit = result.summary.firstCommit;
    }
    if (result.summary.lastCommit && (!lastCommit || result.summary.lastCommit > lastCommit)) {
      lastCommit = result.summary.lastCommit;
    }
  }

  merged.summary = {
    totalCommits,
    totalContributors: merged.contributors.length,
    totalAdditions,
    totalDeletions,
    firstCommit,
    lastCommit,
    activeBranches: 0
  };

  return merged;
}

/**
 * Main function that orchestrates the insights generation process.
 *
 * @param {string} repoPath - Path to the git repository or URL of a remote repository
 * @param {object} [options={}] - Configuration options
 * @param {string} [options.token] - Authentication token for private/remote repos
 * @param {boolean} [options['no-merges']] - If true, exclude merge commits
 * @param {number} [options.concurrency] - Max parallel workers for processing
 * @param {boolean} [options.timing] - If true, show timing information
 * @param {boolean} [options.json] - If true, output JSON to stdout instead of starting server
 * @param {string|boolean} [options.file] - If provided, write JSON to file (or current directory if true)
 * @param {string} [options.csv] - If provided, generate CSV report to this file path
 * @param {string} [options.pdf] - If provided, generate PDF report to this file path
 * @param {Function|false} [options.openBrowser] - Custom browser-open function (defaults to the 'open' package). Pass false to suppress automatic browser opening.
 * @param {string} [options.user] - GitHub username to analyze all repos for
 * @returns {Promise<void>} Promise that resolves when the process completes
 */
export async function main(repoPath, options = {}) {
  let actualRepoPath = repoPath;
  let isCloned = false;
  let result;

  const totalStart = performance.now();

  if (options.user) {
    console.error(chalk.cyan(`repodash: fetching repos for GitHub user "${options.user}"`));
    const repos = await fetchUserRepos(options.user, options.token);
    if (repos.length === 0) {
      console.error(chalk.yellow(`No repos found for user "${options.user}".`));
      return;
    }
    console.error(chalk.cyan(`Found ${repos.length} repos. Cloning and analyzing...`));

    const timings = [];
    const repoResults = [];
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < repos.length; i++) {
      const r = repos[i];
      const cloneDir = mkdtempSync(join(tmpdir(), 'repodash-user-'));
      tempDirs.push(cloneDir);
      try {
        console.error(chalk.cyan(`[${i + 1}/${repos.length}] Cloning ${r.fullName}...`));
        await cloneRemoteRepo(r.cloneUrl, options.token, cloneDir);
        console.error(chalk.cyan(`[${i + 1}/${repos.length}] Analyzing ${r.fullName}...`));
        const { result: repoResult } = await aggregateSingleRepo(
          cloneDir,
          options,
          timings,
          r.fullName
        );
        repoResults.push({ repoName: r.fullName, result: repoResult });
        successCount++;
      } catch (err) {
        console.error(chalk.yellow(`  Skipped ${r.fullName}: ${err.message}`));
        failCount++;
      }
    }

    if (successCount === 0) {
      throw new Error(`All ${repos.length} repos failed to clone or analyze.`);
    }

    result = mergeAggregatedResults(repoResults);

    if (failCount > 0) {
      console.error(chalk.yellow(`  ${failCount} repo(s) failed, ${successCount} analyzed.`));
    }
  } else {
    let clonedRepoName;
    if (repoPath && /^[a-z+]+:\/\//.test(repoPath)) {
      const tempDir = mkdtempSync(join(tmpdir(), 'repodash-clone-'));
      tempDirs.push(tempDir);
      clonedRepoName = extractRepoName(repoPath);
      await cloneRemoteRepo(repoPath, options.token, tempDir);
      actualRepoPath = tempDir;
      isCloned = true;
    }

    console.error(chalk.cyan(`repodash: scanning repo at ${actualRepoPath}`));

    if (options.timing) console.error();

    const timings = [];
    const { result: singleResult, repoName } = await aggregateSingleRepo(
      actualRepoPath,
      options,
      timings,
      clonedRepoName
    );
    result = singleResult;
    result.summary.repoName = repoName;
    result.repos = [{ name: repoName, fullName: repoName, pushedAt: null }];
    // Store a clean copy of the per-repo data (no repoData or repos to avoid circular refs)
    result.repoData = {};
    result.repoData[repoName] = stripRepoData(singleResult);
  }

  const genStart = performance.now();

  let dashboardUrl;

  function dateSuffix() {
    const raw = result?.summary;
    if (!raw?.firstCommit || !raw?.lastCommit) return new Date().toISOString().slice(0, 10);
    return `${raw.firstCommit.slice(0, 10)}--${raw.lastCommit.slice(0, 10)}`;
  }

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
      filePath = join(actualRepoPath || process.cwd(), `repodash_${ts}.json`);
    }
    await writeFile(filePath, JSON.stringify(filtered, null, 2));
    console.error(chalk.green(`✓ Written to ${filePath}`));
  } else if (options.csv) {
    let csvPath = options.csv;
    if (dirname(csvPath) && !existsSync(dirname(csvPath))) {
      throw new Error(`parent directory does not exist: ${dirname(csvPath)}`);
    }
    if (existsSync(csvPath) && statSync(csvPath).isDirectory()) {
      csvPath = join(csvPath, `repodash-${dateSuffix()}.csv`);
    }
    const filtered = filterDatasets(result, options);
    const csvContent = toCSV(filtered);
    await writeFile(csvPath, csvContent, 'utf-8');
    console.error(chalk.green(`✓ Written to ${csvPath}`));
  } else if (options.pdf) {
    let pdfPath = options.pdf;
    if (dirname(pdfPath) && !existsSync(dirname(pdfPath))) {
      throw new Error(`parent directory does not exist: ${dirname(pdfPath)}`);
    }
    if (existsSync(pdfPath) && statSync(pdfPath).isDirectory()) {
      pdfPath = join(pdfPath, `repodash-${dateSuffix()}.pdf`);
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
      await page.pdf({ path: pdfPath, format: 'A4' });
      await browser.close();
      console.error(chalk.green(`✓ Written to ${pdfPath}`));
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

import chalk from 'chalk';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import open from 'open';
import { getAllCommits, getLocalBranchCount } from './git.js';
import { aggregateStream } from './aggregate.js';
import { serveDashboard } from './server.js';

export async function main(repoPath, options = {}) {
  console.error(chalk.cyan(`insights: scanning repo at ${repoPath}`));

  const totalStart = performance.now();

  // Load + aggregate are one combined step because getAllCommits() returns
  // a lazy async generator — the actual git child-process spawn and parsing
  // happen interleaved inside aggregateStream.
  const timings = [];
  const scanStart = performance.now();
  const result = await aggregateStream(
    getAllCommits(repoPath),
    getLocalBranchCount(repoPath),
    timings,
    options.timing
      ? (label, elapsed) => console.error(`    ${label.padEnd(20)} ${elapsed.toFixed(2)}s`)
      : undefined,
  );

  result.summary.repoName = repoPath
    .replace(/[/\\]$/, '')
    .split(/[/\\]/)
    .pop()
    .replace(/\.git$/, '');

  const genStart = performance.now();

  if (options.json) {
    const filtered = filterDatasets(result, options);
    console.log(JSON.stringify(filtered, null, 2));
  } else if (options.file) {
    const filtered = filterDatasets(result, options);
    let filePath;
    if (typeof options.file === 'string') {
      filePath = options.file;
    } else {
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      filePath = join(repoPath, `insights_${ts}.json`);
    }
    await writeFile(filePath, JSON.stringify(filtered, null, 2));
    console.error(chalk.green(`✓ Written to ${filePath}`));
  } else {
    const dashboardDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'dashboard');
    const { port, tmpDir, server } = await serveDashboard(result, dashboardDir);

    const addr = `http://localhost:${port}`;
    console.log(chalk.cyan('📊 insights dashboard:'), chalk.underline(addr));

    open(addr).catch((err) => {
      console.warn(chalk.yellow(`Could not open browser: ${err.message}`));
      console.warn(chalk.yellow(`Open ${addr} manually.`));
    });

    let shuttingDown = false;

    function cleanup() {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log(chalk.gray('\nShutting down insights server...'));
      server.close(() => {
        try {
          rmSync(tmpDir, { recursive: true, force: true });
        } catch {
          void 0;
        }
        process.exit(0);
      });
      setTimeout(() => {
        try {
          rmSync(tmpDir, { recursive: true, force: true });
        } catch {
          void 0;
        }
        process.exit(0);
      }, 5000).unref();
    }

    process.once('SIGINT', cleanup);
    process.once('SIGTERM', cleanup);
    process.stdin.on('close', cleanup);
  }

  if (options.timing) {
    console.error(`  Generate output     ${((performance.now() - genStart) / 1000).toFixed(2)}s`);
    console.error(`  ───────────────────────────`);
    console.error(`  Total               ${((performance.now() - totalStart) / 1000).toFixed(2)}s`);
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

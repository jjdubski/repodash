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

  const t1 = performance.now();
  const commitsStream = getAllCommits(repoPath);
  const branchCountPromise = getLocalBranchCount(repoPath);
  if (options.timing) {
    const elapsed = (performance.now() - t1) / 1000;
    console.error(`  Load git history    ${elapsed.toFixed(2)}s`);
  }

  const t2 = performance.now();
  const result = await aggregateStream(commitsStream, branchCountPromise);
  if (options.timing) {
    const elapsed = (performance.now() - t2) / 1000;
    console.error(`  Aggregate data      ${elapsed.toFixed(2)}s`);
  }

  result.summary.repoName = repoPath
    .replace(/[/\\]$/, '')
    .split(/[/\\]/)
    .pop()
    .replace(/\.git$/, '');

  const t3 = performance.now();

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
    const genTime = (performance.now() - t3) / 1000;
    const totalTime = (performance.now() - totalStart) / 1000;
    console.error(`  Generate output     ${genTime.toFixed(2)}s`);
    console.error(`  ───────────────────────────`);
    console.error(`  Total               ${totalTime.toFixed(2)}s`);
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

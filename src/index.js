import chalk from 'chalk';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmSync } from 'node:fs';
import open from 'open';
import { getAllCommits, getLocalBranchCount } from './git.js';
import { aggregateStream } from './aggregate.js';
import { serveDashboard } from './server.js';

/**
 * Main orchestrator for the insights CLI.
 *
 * Scans a local git repository, aggregates the data, and serves an
 * interactive dashboard in the default browser.
 *
 * @param {string} repoPath - Path to the git repository to analyze
 * @throws {Error} On any extraction, aggregation, or server failure
 */
export async function main(repoPath) {
  console.log(chalk.cyan(`insights: scanning repo at ${repoPath}`));

  const result = await aggregateStream(getAllCommits(repoPath), getLocalBranchCount(repoPath));

  // Derive a human-readable repo name from the path
  result.summary.repoName = repoPath
    .replace(/[/\\]$/, '')
    .split(/[/\\]/)
    .pop()
    .replace(/\.git$/, '');

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
        // temp dir may already be gone — ignore
      }
      process.exit(0);
    });
    setTimeout(() => {
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
      process.exit(0);
    }, 5000).unref();
  }

  process.once('SIGINT', cleanup);
  process.once('SIGTERM', cleanup);
  process.stdin.on('close', cleanup);
}

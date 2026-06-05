import chalk from 'chalk';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAllCommits, getLocalBranchCount } from '../src/git.js';
import { aggregate } from '../src/aggregate.js';
import { serveDashboard } from '../src/server.js';

/**
 * Main orchestrator for the insights CLI.
 *
 * Scans a local git repository, aggregates the data, and serves an
 * interactive dashboard in the default browser.
 *
 * @param {string} repoPath - Path to the git repository to analyze
 */
export async function main(repoPath) {
  console.log(chalk.cyan(`insights: scanning repo at ${repoPath}`));

  try {
    const commits = await getAllCommits(repoPath);
    const branchCount = await getLocalBranchCount(repoPath);
    const result = aggregate(commits, branchCount);

    const dashboardDir = join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      'dashboard'
    );
    await serveDashboard(result, dashboardDir);
  } catch (err) {
    console.error(chalk.red(`Error: ${err.message}`));
    process.exit(1);
  }
}

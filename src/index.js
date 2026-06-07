import chalk from 'chalk';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAllCommits, getLocalBranchCount } from './git.js';
import { aggregate } from './aggregate.js';
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

  const commits = await getAllCommits(repoPath);
  const branchCount = await getLocalBranchCount(repoPath);
  const result = aggregate(commits, branchCount);

  // Derive a human-readable repo name from the path
  result.summary.repoName = repoPath
    .replace(/[/\\]$/, '')
    .split(/[/\\]/)
    .pop()
    .replace(/\.git$/, '');

  const dashboardDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'dashboard');
  await serveDashboard(result, dashboardDir);
}

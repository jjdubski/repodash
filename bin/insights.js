#!/usr/bin/env node

import chalk from 'chalk';
import { main } from '../src/index.js';

const repoPath = process.argv[2];

if (!repoPath) {
  console.log('Usage: insights <path-to-git-repo>');
  process.exit(1);
}

main(repoPath).catch((err) => {
  console.error(chalk.red(`Error: ${err.message}`));
  process.exit(1);
});

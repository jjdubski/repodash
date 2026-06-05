#!/usr/bin/env node

import { main } from '../src/index.js';

const repoPath = process.argv[2];

if (!repoPath) {
  console.log('Usage: insights <path-to-git-repo>');
  process.exit(1);
}

main(repoPath).catch(err => {
  console.error(err);
  process.exit(1);
});

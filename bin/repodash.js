#!/usr/bin/env node

import { parseAndValidate } from '../src/cli.js';
import { main } from '../src/index.js';

const { repoPath, values: options } = parseAndValidate(process.argv.slice(2));

try {
  await main(repoPath, options);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

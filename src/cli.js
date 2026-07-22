import { parseArgs } from 'node:util';
import { createRequire } from 'node:module';
import chalk from 'chalk';

const require = createRequire(import.meta.url);

function printUsage() {
  process.stdout.write(chalk.cyan('Usage: repodash [options] <path-to-git-repo>\n'));
  process.stdout.write(`
Options:
  -h, --help            Show this help message
  -V, --version         Show version number
  --json                Print datasets as JSON to stdout
  --file [path]         Write datasets as JSON to a file (default: repo dir)
  --timing              Show timing breakdown for each step
  --no-merges           Exclude merge commits (faster for large repos)
  --concurrency <n>     Number of parallel workers (default: CPU count, max: 8)
  --token <token>       GitHub personal access token for remote/private repos
  --user <username>     Fetch and analyze all repos for a GitHub user
  --summary             Include summary dataset
  --contributions       Include contributions dataset
  --contributors        Include contributors dataset
  --frequency           Include frequency dataset
  --activity            Include activity dataset
  --csv <path>          Generate a CSV report at the specified path
  --pdf <path>          Generate a PDF report at the specified path
                        Requires Playwright — run "npx playwright install chromium"


If none of --summary/--contributions/--contributors/--frequency/--activity
are specified, all datasets are included.

--json, --file, --csv, and --pdf are mutually exclusive.
`);
}

function parseFileFlag(argv) {
  let fileValue;
  let fileIsBool = false;
  const filteredArgs = [];

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--file') {
      if (fileValue !== undefined || fileIsBool) {
        console.error(chalk.red('duplicate --file flag.\n'));
        printUsage();
        process.exit(1);
      }
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('-')) {
        fileValue = next;
        i++;
      } else {
        fileIsBool = true;
      }
    } else {
      filteredArgs.push(argv[i]);
    }
  }

  return { fileValue, fileIsBool, filteredArgs };
}

function determineRepoPath(values, positionals) {
  let repoPath;
  if (typeof values.file === 'string' && positionals.length === 0) {
    if (values.file === '') {
      console.error(chalk.red('--file value cannot be empty.\n'));
      printUsage();
      process.exit(1);
    }
    repoPath = values.file;
    values.file = true;
  } else if (positionals.length > 1) {
    console.error(chalk.red('multiple repository paths provided.\n'));
    printUsage();
    process.exit(1);
  } else if (positionals.length > 0) {
    repoPath = positionals[0];
  } else if (!values.user) {
    console.error(chalk.red('no repository path provided.\n'));
    printUsage();
    process.exit(1);
  }
  return repoPath;
}

function validateUserAndPath(values, positionals) {
  if (values.user && positionals.length > 0) {
    console.error(chalk.red('--user and a repository path are mutually exclusive.\n'));
    printUsage();
    process.exit(1);
  }
}

export function parseAndValidate(argv) {
  const { fileValue, fileIsBool, filteredArgs } = parseFileFlag(argv);

  const { values, positionals } = parseArgs({
    options: {
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'V' },
      json: { type: 'boolean' },
      summary: { type: 'boolean' },
      contributions: { type: 'boolean' },
      contributors: { type: 'boolean' },
      frequency: { type: 'boolean' },
      activity: { type: 'boolean' },
      csv: { type: 'string' },
      pdf: { type: 'string' },
      timing: { type: 'boolean' },
      'no-merges': { type: 'boolean' },
      concurrency: { type: 'string' },
      token: { type: 'string' },
      user: { type: 'string' }
    },
    strict: false,
    allowPositionals: true,
    args: filteredArgs
  });

  if (fileValue !== undefined) {
    values.file = fileValue;
  } else if (fileIsBool) {
    values.file = true;
  }

  if (values.help) {
    printUsage();
    process.exit(0);
  }

  if (values.version) {
    const { version } = require('../package.json');
    console.log(version);
    process.exit(0);
  }

  if (values.concurrency !== undefined) {
    const n = Number(values.concurrency);
    if (!Number.isInteger(n) || n < 1) {
      console.error(chalk.red('--concurrency must be a positive integer.\n'));
      printUsage();
      process.exit(1);
    }
    if (n > 8) {
      console.log(chalk.yellow('Warning: --concurrency cannot exceed 8, setting to 8.\n'));
      values.concurrency = 8;
    }
    values.concurrency = n;
  }

  validateUserAndPath(values, positionals);

  const repoPath = determineRepoPath(values, positionals);

  if (values.json && values.file) {
    console.error(chalk.red('--json and --file are mutually exclusive.\n'));
    printUsage();
    process.exit(1);
  }

  if (values.csv !== undefined) {
    const csvCount = filteredArgs.filter(
      (arg) => arg === '--csv' || arg.startsWith('--csv=')
    ).length;
    if (csvCount > 1) {
      console.error(chalk.red('duplicate --csv flag.\n'));
      printUsage();
      process.exit(1);
    }
    if (values.csv === '') {
      console.error(chalk.red('--csv value cannot be empty.\n'));
      printUsage();
      process.exit(1);
    }
    if (values.json || values.file || values.pdf) {
      console.error(chalk.red('--csv cannot be combined with --json, --file, or --pdf.\n'));
      printUsage();
      process.exit(1);
    }
  }

  if (values.pdf !== undefined) {
    if (values.pdf === '') {
      console.error(chalk.red('--pdf value cannot be empty.\n'));
      printUsage();
      process.exit(1);
    }
    if (values.json || values.file || values.csv) {
      console.error(chalk.red('--pdf cannot be combined with --json, --file, or --csv.\n'));
      printUsage();
      process.exit(1);
    }
  }

  delete values.help;
  delete values.version;

  return { repoPath, values };
}

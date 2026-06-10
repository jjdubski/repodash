import { parseArgs } from 'node:util';
import chalk from 'chalk';

function printUsage() {
  process.stdout.write(chalk.cyan('Usage: insights [options] <path-to-git-repo>\n'));
  process.stdout.write(`
Options:
  -h, --help            Show this help message
  --json                Print datasets as JSON to stdout
  --file [path]         Write datasets as JSON to a file (default: repo dir)
  --timing              Show timing breakdown for each step
  --no-merges           Exclude merge commits (faster for large repos)
  --summary             Include summary dataset
  --contributions       Include contributions dataset
  --contributors        Include contributors dataset
  --frequency           Include frequency dataset
  --activity            Include activity dataset

If none of --summary/--contributions/--contributors/--frequency/--activity
are specified, all datasets are included.

--json and --file are mutually exclusive.
`);
}

function parseFileFlag(argv) {
  let fileValue;
  let fileIsBool = false;
  const filteredArgs = [];

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--file') {
      if (fileValue !== undefined || fileIsBool) {
        console.error(chalk.red('Error: duplicate --file flag.\n'));
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
      console.error(chalk.red('Error: --file value cannot be empty.\n'));
      printUsage();
      process.exit(1);
    }
    repoPath = values.file;
    values.file = true;
  } else if (positionals.length > 1) {
    console.error(chalk.red('Error: multiple repository paths provided.\n'));
    printUsage();
    process.exit(1);
  } else if (positionals.length > 0) {
    repoPath = positionals[0];
  } else {
    console.error(chalk.red('Error: no repository path provided.\n'));
    printUsage();
    process.exit(1);
  }
  return repoPath;
}

export function parseAndValidate(argv) {
  const { fileValue, fileIsBool, filteredArgs } = parseFileFlag(argv);

  const { values, positionals } = parseArgs({
    options: {
      help: { type: 'boolean', short: 'h' },
      json: { type: 'boolean' },
      summary: { type: 'boolean' },
      contributions: { type: 'boolean' },
      contributors: { type: 'boolean' },
      frequency: { type: 'boolean' },
      activity: { type: 'boolean' },
      timing: { type: 'boolean' },
      'no-merges': { type: 'boolean' }
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

  const repoPath = determineRepoPath(values, positionals);

  if (values.json && values.file) {
    console.error(chalk.red('Error: --json and --file are mutually exclusive.\n'));
    printUsage();
    process.exit(1);
  }

  delete values.help;

  return { repoPath, values };
}

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { statSync } from 'node:fs';

// Using %s (subject-only) in the pretty=format is intentional — commit
// subjects are single-line, which keeps the output safe to split on this
// delimiter. A full-body format (%B) could contain arbitrary characters
// including the delimiter itself, corrupting the parse.
const COMMIT_DELIMITER = '---COMMIT---';

// Printed twice in the git format string so the full delimiter line
// appears alone before each commit block.  Checked by the streaming
// parser to decide when to flush accumulated lines.
const DELIMITER_LINE = COMMIT_DELIMITER + COMMIT_DELIMITER;

function validateRepoPath(repoPath) {
  if (typeof repoPath !== 'string' || repoPath.length === 0) {
    throw new Error(`Not a git repository: ${repoPath}`);
  }
  try {
    if (!statSync(repoPath).isDirectory()) {
      throw new Error(`Not a git repository: ${repoPath}`);
    }
  } catch (e) {
    if (e.code === 'ENOENT') throw new Error(`Not a git repository: ${repoPath}`, { cause: e });
    throw e;
  }
}

function spawnGit(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `git command failed with exit code ${code}`));
        return;
      }
      resolve({ stdout, stderr });
    });

    child.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Parse a commit entry from an array of lines.
 * First line is the pretty=format header (hash|name|email|date|message).
 * Remaining lines are --numstat output (added\tdeleted\tfilepath).
 *
 * @param {string[]} lines - Lines for a single commit (header + numstat rows)
 * @returns {object|null} Parsed commit object, or null if header is invalid
 */
function parseCommit(lines) {
  if (!lines || lines.length === 0) return null;

  const headerLine = lines[0];
  const headerParts = headerLine.split('|');
  if (headerParts.length < 5) return null;

  const [hash, name, email, date, ...messageParts] = headerParts;
  const message = messageParts.join('|'); // message may contain '|'

  // Remaining lines are --numstat output; filter out empty lines
  // (merge commits may produce no stat lines)
  const statLines = lines.slice(1).filter((l) => l.trim() !== '');

  let additions = 0;
  let deletions = 0;
  const files = [];

  for (const line of statLines) {
    const cols = line.split('\t');
    if (cols.length < 3) continue;

    // Binary files show '-' instead of numbers — treat as 0.
    // Fallback || 0 guards against NaN from unexpected numstat values.
    const added = cols[0] === '-' ? 0 : parseInt(cols[0], 10) || 0;
    const deleted = cols[1] === '-' ? 0 : parseInt(cols[1], 10) || 0;

    additions += added;
    deletions += deleted;
    files.push(cols[2]);
  }

  return {
    hash,
    author: { name, email },
    date,
    message,
    stats: { additions, deletions, files: files.length },
    files,
  };
}

/**
 * Stream-parse commits from a local git repository using an AsyncGenerator.
 *
 * Reads `git log --all --numstat` output line-by-line with a readline
 * interface.  Commits are delimited by DELIMITER_LINE (printed twice in the
 * pretty=format), which lands on its own line before each commit block.
 * Each time the parser encounters the delimiter it flushes the previously
 * accumulated lines as a parsed commit object.
 *
 * An AbortController kills the child process when the consumer cancels
 * iteration early, preventing resource leaks on large repos.
 *
 * @param {string} repoPath - Path to the git repository
 * @returns {AsyncGenerator<object>} Parsed commit objects yielded one at a time
 */
export async function* getAllCommits(repoPath) {
  validateRepoPath(repoPath);

  const ac = new AbortController();
  const child = spawn(
    'git',
    ['log', '--all', `--pretty=format:${DELIMITER_LINE}%n%H|%an|%ae|%ai|%s`, '--numstat'],
    { cwd: repoPath, signal: ac.signal },
  );

  const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
  let currentLines = [];
  let stderr = '';
  let exitCode = null;
  let processError = null;

  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  child.on('close', (code) => {
    exitCode = code;
  });
  child.on('error', (err) => {
    processError = err;
  });

  try {
    for await (const line of rl) {
      if (line === DELIMITER_LINE) {
        if (currentLines.length > 0) {
          const commit = parseCommit(currentLines);
          if (commit) yield commit;
        }
        currentLines = [];
      } else {
        currentLines.push(line);
      }
    }

    if (currentLines.length > 0) {
      const commit = parseCommit(currentLines);
      if (commit) yield commit;
    }

    // Wait for git process to exit if it hasn't already
    if (exitCode === null) {
      exitCode = await new Promise((resolve) => {
        child.on('close', resolve);
      });
    }

    if (exitCode !== 0) {
      if (processError) throw processError;
      throw new Error(stderr.trim() || `git command failed with exit code ${exitCode}`);
    }
  } finally {
    rl.close();
    ac.abort();
  }
}

/**
 * Count the number of local branches in a git repository.
 *
 * @param {string} repoPath - Path to the git repository
 * @returns {Promise<number>} Number of local branches
 */
export function getLocalBranchCount(repoPath) {
  validateRepoPath(repoPath);

  return spawnGit(['branch', '--list'], repoPath).then(
    ({ stdout }) => stdout.trim().split('\n').filter(Boolean).length,
  );
}

import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';

// Using %s (subject-only) in the pretty=format is intentional — commit
// subjects are single-line, which keeps the output safe to split on this
// delimiter. A full-body format (%B) could contain arbitrary characters
// including the delimiter itself, corrupting the parse.
const COMMIT_DELIMITER = '---COMMIT---';

function validateRepoPath(repoPath) {
  if (typeof repoPath !== 'string' || repoPath.length === 0) {
    throw new Error(`Not a git repository: ${repoPath}`);
  }
  try {
    if (!statSync(repoPath).isDirectory()) {
      throw new Error(`Not a git repository: ${repoPath}`);
    }
  } catch (e) {
    if (e.code === 'ENOENT') throw new Error(`Not a git repository: ${repoPath}`);
    throw e;
  }
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
 * Extract all commits from a local git repository.
 *
 * Runs `git log --all --numstat` in a single pass, streaming output
 * through a child process to handle large repositories efficiently.
 *
 * @param {string} repoPath - Path to the git repository
 * @returns {Promise<Array>} Array of parsed commit objects
 */
export function getAllCommits(repoPath) {
  validateRepoPath(repoPath);

  return new Promise((resolve, reject) => {
    const child = spawn(
      'git',
      [
        'log',
        '--all',
        `--pretty=format:${COMMIT_DELIMITER}%n%H|%an|%ae|%ai|%s`,
        '--numstat',
      ],
      { cwd: repoPath }
    );

    const commits = [];
    let buffer = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString();

      // Split on the delimiter. Complete commits are the segments
      // between delimiters; the last segment is kept in the buffer
      // as it may be incomplete.
      const parts = buffer.split(COMMIT_DELIMITER);
      buffer = parts.pop();

      for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed) continue;

        const lines = trimmed.split('\n');
        const commit = parseCommit(lines);
        if (commit) commits.push(commit);
      }
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(
          new Error(stderr.trim() || `git command failed with exit code ${code}`)
        );
        return;
      }

      // Process any remaining commit data still in the buffer
      const trimmed = buffer.trim();
      if (trimmed) {
        const lines = trimmed.split('\n');
        const commit = parseCommit(lines);
        if (commit) commits.push(commit);
      }

      resolve(commits);
    });

    child.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Count the number of local branches in a git repository.
 *
 * @param {string} repoPath - Path to the git repository
 * @returns {Promise<number>} Number of local branches
 */
export function getLocalBranchCount(repoPath) {
  validateRepoPath(repoPath);

  return new Promise((resolve, reject) => {
    const child = spawn('git', ['branch', '--list'], { cwd: repoPath });
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
        reject(
          new Error(stderr.trim() || `git command failed with exit code ${code}`)
        );
        return;
      }
      const branches = stdout.trim().split('\n').filter(Boolean);
      resolve(branches.length);
    });

    child.on('error', (err) => {
      reject(err);
    });
  });
}

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ---------------------------------------------------------------------------
// Fixture repository paths (set during before())
// ---------------------------------------------------------------------------
/** @type {string} */
let mainRepoPath;
/** @type {string} */
let emptyRepoPath;
/** @type {string} */
let singleRepoPath;
/** @type {string} */
let nonGitDir;
/** @type {string} */
let tmpDir;

// ---------------------------------------------------------------------------
// Module under test — imported once in before() and reused by all tests
// ---------------------------------------------------------------------------
/** @type {import('../src/git.js').getAllCommits} */
let getAllCommits;
/** @type {import('../src/git.js').getLocalBranchCount} */
let getLocalBranchCount;

before(async () => {
  const mod = await import('../src/git.js');
  getAllCommits = mod.getAllCommits;
  getLocalBranchCount = mod.getLocalBranchCount;
});

before(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'insights-test-'));

  // ── Main repo: 5 commits + 2 extra branches ──────────────────────────
  mainRepoPath = join(tmpDir, 'main-repo');
  execSync(`git init "${mainRepoPath}"`, { stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: mainRepoPath, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', {
    cwd: mainRepoPath,
    stdio: 'pipe',
  });

  // Commit 1: single file added
  writeFileSync(join(mainRepoPath, 'file1.txt'), 'hello\n');
  execSync('git add file1.txt && git commit -m "Initial commit"', {
    cwd: mainRepoPath,
    stdio: 'pipe',
  });

  // Commit 2: modify existing + add another file
  appendFileSync(join(mainRepoPath, 'file1.txt'), 'world\n');
  writeFileSync(join(mainRepoPath, 'file2.txt'), 'feature a\n');
  execSync('git add file1.txt file2.txt && git commit -m "Add feature A"', {
    cwd: mainRepoPath,
    stdio: 'pipe',
  });

  // Commit 3: by a different author
  writeFileSync(join(mainRepoPath, 'file3.txt'), 'feature b\n');
  execSync(
    'git add file3.txt && git commit -m "Add feature B" --author="Developer2 <dev2@test.com>"',
    { cwd: mainRepoPath, stdio: 'pipe' },
  );

  // Commit 4: binary file (file with null bytes → detected as binary by git)
  writeFileSync(
    join(mainRepoPath, 'binary.bin'),
    Buffer.from([0x00, 0xff, 0x00, 0x01, 0x00]),
  );
  execSync('git add binary.bin && git commit -m "Add binary file"', {
    cwd: mainRepoPath,
    stdio: 'pipe',
  });

  // Commit 5: empty commit (simulates a merge with no file changes)
  execSync('git commit --allow-empty -m "Merge branch (no changes)"', {
    cwd: mainRepoPath,
    stdio: 'pipe',
  });

  // Create extra branches for getLocalBranchCount testing
  execSync('git branch feature-a', { cwd: mainRepoPath, stdio: 'pipe' });
  execSync('git branch feature-b', { cwd: mainRepoPath, stdio: 'pipe' });

  // ── Empty repo: initialised but has zero commits ─────────────────────
  emptyRepoPath = join(tmpDir, 'empty-repo');
  execSync(`git init "${emptyRepoPath}"`, { stdio: 'pipe' });

  // ── Single-commit repo: exactly one commit, one branch ───────────────
  singleRepoPath = join(tmpDir, 'single-repo');
  execSync(`git init "${singleRepoPath}"`, { stdio: 'pipe' });
  execSync('git config user.name "Test"', {
    cwd: singleRepoPath,
    stdio: 'pipe',
  });
  execSync('git config user.email "test@test.com"', {
    cwd: singleRepoPath,
    stdio: 'pipe',
  });
  writeFileSync(join(singleRepoPath, 'readme.md'), '# Single\n');
  execSync('git add readme.md && git commit -m "Initial commit"', {
    cwd: singleRepoPath,
    stdio: 'pipe',
  });

  // ── Regular directory (no .git) — for non-git directory error testing
  nonGitDir = join(tmpDir, 'not-a-repo');
  execSync(`mkdir "${nonGitDir}"`, { stdio: 'pipe' });
});

after(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests for getLocalBranchCount()
// ---------------------------------------------------------------------------
describe('getLocalBranchCount()', () => {
  it('should return 1 for a repo with only a default branch', async () => {
    const count = await getLocalBranchCount(singleRepoPath);

    assert.strictEqual(count, 1);
  });

  it('should return N after creating additional branches', async () => {
    const count = await getLocalBranchCount(mainRepoPath);

    // mainRepo has: default branch + feature-a + feature-b = 3
    assert.strictEqual(count, 3);
  });
});

// ---------------------------------------------------------------------------
// Tests for getAllCommits()
// ---------------------------------------------------------------------------
describe('getAllCommits()', () => {
  it('should return correct number of commits', async () => {
    const commits = await getAllCommits(mainRepoPath);

    assert.strictEqual(commits.length, 5);
  });

  it('each commit should have the expected shape', async () => {
    const commits = await getAllCommits(mainRepoPath);

    assert.ok(commits.length > 0);
    for (const commit of commits) {
      // Identity fields
      assert.ok(
        typeof commit.hash === 'string' && commit.hash.length > 0,
        `hash should be a non-empty string, got ${typeof commit.hash}`,
      );

      // Author object
      assert.ok(commit.author, 'commit.author should exist');
      assert.ok(
        typeof commit.author.name === 'string',
        `author.name should be a string, got ${typeof commit.author.name}`,
      );
      assert.ok(
        typeof commit.author.email === 'string',
        `author.email should be a string, got ${typeof commit.author.email}`,
      );

      // Date & message
      assert.ok(
        typeof commit.date === 'string' && commit.date.length > 0,
        `date should be a non-empty string, got ${typeof commit.date}`,
      );
      assert.ok(
        typeof commit.message === 'string',
        `message should be a string, got ${typeof commit.message}`,
      );

      // Stats
      assert.ok(commit.stats, 'commit.stats should exist');
      assert.ok(
        typeof commit.stats.additions === 'number' &&
          Number.isInteger(commit.stats.additions) &&
          commit.stats.additions >= 0,
        `stats.additions should be a non-negative integer, got ${commit.stats.additions}`,
      );
      assert.ok(
        typeof commit.stats.deletions === 'number' &&
          Number.isInteger(commit.stats.deletions) &&
          commit.stats.deletions >= 0,
        `stats.deletions should be a non-negative integer, got ${commit.stats.deletions}`,
      );
      assert.ok(
        typeof commit.stats.files === 'number' &&
          Number.isInteger(commit.stats.files) &&
          commit.stats.files >= 0,
        `stats.files should be a non-negative integer, got ${commit.stats.files}`,
      );

      // Files array
      assert.ok(
        Array.isArray(commit.files),
        'commit.files should be an array',
      );
    }
  });

  it('should handle a repo with a single commit', async () => {
    const commits = await getAllCommits(singleRepoPath);

    assert.strictEqual(commits.length, 1);
    assert.strictEqual(commits[0].stats.files, 1);
    assert.strictEqual(commits[0].files.length, 1);
    assert.ok(commits[0].files[0].endsWith('readme.md'));
  });

  it('should throw synchronously for a non-existent path', () => {
    assert.throws(
      () => getAllCommits('/nonexistent/path/for/testing'),
      { name: 'Error' },
      'should throw a descriptive error for invalid paths',
    );
  });

  it('should return an empty array for an empty repo (no commits)', async () => {
    // git log --all on a repo with zero commits returns empty output (exit 0)
    const commits = await getAllCommits(emptyRepoPath);

    assert.ok(Array.isArray(commits));
    assert.strictEqual(commits.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------
describe('edge cases', () => {
  it('getLocalBranchCount should reject for a non-existent path', () => {
    // getLocalBranchCount now has upfront path validation like getAllCommits,
    // so it throws synchronously.
    assert.throws(
      () => getLocalBranchCount('/nonexistent/path/for/testing'),
      { name: 'Error' },
      'should throw a descriptive error for invalid paths',
    );
  });

  it('empty repo returns zero branches', async () => {
    const count = await getLocalBranchCount(emptyRepoPath);

    // A freshly initialised repo with no commits has no branches yet.
    assert.strictEqual(count, 0);
  });

  it('should handle commits with no file changes (empty/merge commits)', async () => {
    const commits = await getAllCommits(mainRepoPath);

    // git log returns newest-first, so the empty commit comes first.
    const emptyCommit = commits[0];
    assert.strictEqual(emptyCommit.message, 'Merge branch (no changes)');
    assert.strictEqual(emptyCommit.stats.additions, 0);
    assert.strictEqual(emptyCommit.stats.deletions, 0);
    assert.strictEqual(emptyCommit.stats.files, 0);
    assert.deepStrictEqual(emptyCommit.files, []);
  });

  it('should handle binary files without crashing', async () => {
    const commits = await getAllCommits(mainRepoPath);

    const binaryCommit = commits.find(
      (c) => c.message === 'Add binary file',
    );
    assert.ok(binaryCommit, 'the binary-file commit should be present');
    assert.ok(
      binaryCommit.files.includes('binary.bin'),
      `expected binary.bin in files, got ${JSON.stringify(binaryCommit.files)}`,
    );

    // Binary files produce '-' in --numstat, which gets parsed as 0.
    assert.strictEqual(binaryCommit.stats.additions, 0);
    assert.strictEqual(binaryCommit.stats.deletions, 0);
    // The file is still counted in stats.files and the files array.
    assert.strictEqual(binaryCommit.stats.files, 1);
  });

  it('should capture commits from different authors correctly', async () => {
    const commits = await getAllCommits(mainRepoPath);

    const devCommit = commits.find(
      (c) => c.author.email === 'dev2@test.com',
    );
    assert.ok(
      devCommit,
      'a commit from Developer2 <dev2@test.com> should exist',
    );
    assert.strictEqual(devCommit.author.name, 'Developer2');
    assert.strictEqual(devCommit.message, 'Add feature B');
  });

  it('getAllCommits should reject for a non-git directory', async () => {
    // A regular directory passes statSync().isDirectory(), so the function
    // spawns git which fails asynchronously (not a repo). Must use rejects().
    await assert.rejects(
      () => getAllCommits(nonGitDir),
      { name: 'Error' },
      'should reject for a regular directory without .git',
    );
  });

  it('getLocalBranchCount should reject for a non-git directory', async () => {
    await assert.rejects(
      () => getLocalBranchCount(nonGitDir),
      { name: 'Error' },
      'should reject for a regular directory without .git',
    );
  });
});

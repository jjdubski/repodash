import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { aggregate, aggregateStream, aggregateStreamParallel } from '../src/aggregate.js';
import { getAllCommits, getLocalBranchCount } from '../src/git.js';

// ---------------------------------------------------------------------------
// Fixture helpers — mirror aggregate.test.js
// ---------------------------------------------------------------------------

function makeCommit(overrides = {}) {
  const defaults = {
    hash: 'abc123',
    author: { name: 'Test User', email: 'test@test.com' },
    date: '2025-01-15T10:30:00+00:00',
    message: 'Test commit',
    stats: { additions: 10, deletions: 5, files: 2 },
    files: ['src/file1.js', 'src/file2.js'],
  };
  return {
    ...defaults,
    ...overrides,
    author: { ...defaults.author, ...overrides.author },
    stats: { ...defaults.stats, ...overrides.stats },
  };
}

function assertEmptyResult(result, branchCount) {
  assert.strictEqual(result.summary.totalCommits, 0);
  assert.strictEqual(result.summary.totalContributors, 0);
  assert.strictEqual(result.summary.totalAdditions, 0);
  assert.strictEqual(result.summary.totalDeletions, 0);
  assert.strictEqual(result.summary.firstCommit, null);
  assert.strictEqual(result.summary.lastCommit, null);
  assert.strictEqual(result.summary.activeBranches, branchCount);
  assert.deepStrictEqual(result.contributions, []);
  assert.deepStrictEqual(result.contributors, []);
  assert.deepStrictEqual(result.frequency, []);
  assert.strictEqual(result.activity.byDayOfWeek.length, 7);
  for (const entry of result.activity.byDayOfWeek) {
    assert.strictEqual(entry.count, 0);
  }
  assert.strictEqual(result.activity.byHour.length, 24);
  for (const entry of result.activity.byHour) {
    assert.strictEqual(entry.count, 0);
  }
  assert.deepStrictEqual(result.activity.topFiles, []);
}

function noreplyEmail(username, id = '') {
  const prefix = id ? `${id}+` : '';
  return `${prefix}${username}@users.noreply.github.com`;
}

function assertMergedContributor(result, expected) {
  assert.strictEqual(result.contributors.length, 1);
  const c = result.contributors[0];
  assert.strictEqual(c.totalCommits, expected.totalCommits);
  if (expected.additions !== undefined) assert.strictEqual(c.additions, expected.additions);
  if (expected.deletions !== undefined) assert.strictEqual(c.deletions, expected.deletions);
  if (expected.email !== undefined) assert.strictEqual(c.email, expected.email);
}

// ---------------------------------------------------------------------------
// Async iterable helpers
// ---------------------------------------------------------------------------

async function* toStream(commits) {
  for (const commit of commits) {
    yield commit;
  }
}

async function* emptyStream() {
  // nothing to yield
}

async function* errorStream() {
  yield makeCommit({ hash: 'beforeThrow' });
  throw new Error('stream error!');
}

function immediateError() {
  return {
    [Symbol.asyncIterator]() {
      return {
        next() {
          return Promise.reject(new Error('immediate fail'));
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('aggregateStream (async stream function)', () => {
  // ----- a. Basic correctness — same result as aggregate ------------------

  describe('equivalence with aggregate', () => {
    it('should produce identical result to aggregate for single commit', async () => {
      const commits = [makeCommit({ hash: 'eq1' })];
      const sync = aggregate(commits, 1);
      const async_ = await aggregateStream(toStream(commits), 1);
      assert.deepStrictEqual(async_, sync);
    });

    it('should produce identical result to aggregate for multiple commits across days', async () => {
      const commits = [
        makeCommit({
          hash: 'c1',
          author: { name: 'Alice', email: 'alice@test.com' },
          date: '2025-01-15T10:00:00Z',
          stats: { additions: 10, deletions: 2, files: 1 },
          files: ['a.js'],
        }),
        makeCommit({
          hash: 'c2',
          author: { name: 'Alice', email: 'alice@test.com' },
          date: '2025-01-15T11:00:00Z',
          stats: { additions: 5, deletions: 1, files: 1 },
          files: ['b.js'],
        }),
        makeCommit({
          hash: 'c3',
          author: { name: 'Bob', email: 'bob@test.com' },
          date: '2025-01-16T12:00:00Z',
          stats: { additions: 20, deletions: 3, files: 2 },
          files: ['c.js', 'd.js'],
        }),
      ];
      const sync = aggregate(commits, 2);
      const async_ = await aggregateStream(toStream(commits), 2);
      assert.deepStrictEqual(async_, sync);
    });

    it('should produce identical result with unsorted commit input', async () => {
      const commits = [
        makeCommit({
          hash: 'u1',
          author: { name: 'Alice', email: 'alice@test.com' },
          date: '2025-01-10T10:00:00Z',
          stats: { additions: 5, deletions: 1, files: 1 },
          files: ['a.js'],
        }),
        makeCommit({
          hash: 'u2',
          author: { name: 'Bob', email: 'bob@test.com' },
          date: '2025-01-12T14:00:00Z',
          stats: { additions: 10, deletions: 3, files: 1 },
          files: ['b.js'],
        }),
        makeCommit({
          hash: 'u3',
          author: { name: 'Bob', email: 'bob@test.com' },
          date: '2025-01-13T09:00:00Z',
          stats: { additions: 2, deletions: 0, files: 1 },
          files: ['c.js'],
        }),
        makeCommit({
          hash: 'u4',
          author: { name: 'Charlie', email: 'charlie@test.com' },
          date: '2025-01-15T11:00:00Z',
          stats: { additions: 15, deletions: 2, files: 1 },
          files: ['d.js'],
        }),
      ];
      const shuffled = [...commits].reverse();
      const sync = aggregate(shuffled, 1);
      const async_ = await aggregateStream(toStream(shuffled), 1);
      assert.deepStrictEqual(async_, sync);
    });
  });

  // ----- b. Empty stream --------------------------------------------------

  describe('empty stream', () => {
    it('should return empty result (branchCount = 1)', async () => {
      const result = await aggregateStream(emptyStream(), 1);
      assertEmptyResult(result, 1);
    });

    it('should return empty result (branchCount = 0)', async () => {
      const result = await aggregateStream(emptyStream(), 0);
      assertEmptyResult(result, 0);
    });

    it('should return empty result (branchCount = 42)', async () => {
      const result = await aggregateStream(emptyStream(), 42);
      assertEmptyResult(result, 42);
    });
  });

  // ----- c. Single commit stream ------------------------------------------

  describe('single commit stream', () => {
    const commit = makeCommit({ hash: 'single1' });

    it('should have correct summary totals', async () => {
      const result = await aggregateStream(toStream([commit]), 1);

      assert.strictEqual(result.summary.totalCommits, 1);
      assert.strictEqual(result.summary.totalContributors, 1);
      assert.strictEqual(result.summary.totalAdditions, 10);
      assert.strictEqual(result.summary.totalDeletions, 5);
      assert.strictEqual(result.summary.firstCommit, commit.date);
      assert.strictEqual(result.summary.lastCommit, commit.date);
      assert.strictEqual(result.summary.activeBranches, 1);
    });

    it('should have contributions with 1 entry', async () => {
      const result = await aggregateStream(toStream([commit]), 1);

      assert.strictEqual(result.contributions.length, 1);
      assert.strictEqual(result.contributions[0].date, '2025-01-15');
      assert.strictEqual(result.contributions[0].count, 1);
      assert.strictEqual(result.contributions[0].authorDetails.length, 1);
      assert.strictEqual(result.contributions[0].authorDetails[0].author, 'Test User');
      assert.strictEqual(result.contributions[0].authorDetails[0].count, 1);
      assert.strictEqual(result.contributions[0].authorDetails[0].additions, 10);
      assert.strictEqual(result.contributions[0].authorDetails[0].deletions, 5);
    });

    it('should have contributors with 1 entry', async () => {
      const result = await aggregateStream(toStream([commit]), 1);

      assert.strictEqual(result.contributors.length, 1);
      const c = result.contributors[0];
      assert.strictEqual(c.name, 'Test User');
      assert.strictEqual(c.email, 'test@test.com');
      assert.strictEqual(c.totalCommits, 1);
      assert.strictEqual(c.additions, 10);
      assert.strictEqual(c.deletions, 5);
      assert.strictEqual(c.firstCommit, commit.date);
      assert.strictEqual(c.lastCommit, commit.date);
    });
  });

  // ----- c2. Commits with missing stats or files ---------------------------

  describe('commits with missing stats or files', () => {
    it('should handle commit with stats: undefined (0 additions/deletions)', async () => {
      const commit = makeCommit({ hash: 'nostats' });
      delete commit.stats;
      const result = await aggregateStream(toStream([commit]), 1);

      assert.strictEqual(result.summary.totalCommits, 1);
      assert.strictEqual(result.summary.totalAdditions, 0);
      assert.strictEqual(result.summary.totalDeletions, 0);
      assert.strictEqual(result.frequency[0].additions, 0);
      assert.strictEqual(result.frequency[0].deletions, 0);
      assert.strictEqual(result.contributors[0].additions, 0);
      assert.strictEqual(result.contributors[0].deletions, 0);
    });

    it('should handle commit with files: null (no file entries, no crash)', async () => {
      const commit = makeCommit({ hash: 'nofiles', files: null });
      const result = await aggregateStream(toStream([commit]), 1);

      assert.strictEqual(result.summary.totalCommits, 1);
      assert.deepStrictEqual(result.activity.topFiles, []);
      // Per-day files also empty
      assert.deepStrictEqual(result.contributions[0].topFiles, []);
    });
  });

  // ----- d. Multiple commits across days ----------------------------------

  describe('multiple commits across days', () => {
    const commits = [
      makeCommit({
        hash: 'd1',
        author: { name: 'Alice', email: 'alice@test.com' },
        date: '2025-01-15T10:00:00Z',
        stats: { additions: 10, deletions: 2, files: 1 },
        files: ['a.js'],
      }),
      makeCommit({
        hash: 'd2',
        author: { name: 'Alice', email: 'alice@test.com' },
        date: '2025-01-15T11:00:00Z',
        stats: { additions: 5, deletions: 1, files: 1 },
        files: ['b.js'],
      }),
      makeCommit({
        hash: 'd3',
        author: { name: 'Bob', email: 'bob@test.com' },
        date: '2025-01-16T12:00:00Z',
        stats: { additions: 20, deletions: 3, files: 2 },
        files: ['c.js', 'd.js'],
      }),
      makeCommit({
        hash: 'd4',
        author: { name: 'Alice', email: 'alice@test.com' },
        date: '2025-01-17T09:00:00Z',
        stats: { additions: 3, deletions: 0, files: 1 },
        files: ['e.js'],
      }),
    ];

    it('should have correct summary', async () => {
      const result = await aggregateStream(toStream(commits), 1);

      assert.strictEqual(result.summary.totalCommits, 4);
      assert.strictEqual(result.summary.totalContributors, 2);
      assert.strictEqual(result.summary.totalAdditions, 10 + 5 + 20 + 3);
      assert.strictEqual(result.summary.totalDeletions, 2 + 1 + 3 + 0);
      assert.strictEqual(result.summary.firstCommit, '2025-01-15T10:00:00Z');
      assert.strictEqual(result.summary.lastCommit, '2025-01-17T09:00:00Z');
    });

    it('should have frequency entries sorted by date', async () => {
      const result = await aggregateStream(toStream(commits), 1);

      assert.strictEqual(result.frequency.length, 3);
      assert.strictEqual(result.frequency[0].date, '2025-01-15');
      assert.strictEqual(result.frequency[1].date, '2025-01-16');
      assert.strictEqual(result.frequency[2].date, '2025-01-17');

      assert.strictEqual(result.frequency[0].additions, 15);
      assert.strictEqual(result.frequency[0].deletions, 3);
      assert.strictEqual(result.frequency[1].additions, 20);
      assert.strictEqual(result.frequency[1].deletions, 3);
      assert.strictEqual(result.frequency[2].additions, 3);
      assert.strictEqual(result.frequency[2].deletions, 0);
    });

    it('should have correct contribution breakdown per day', async () => {
      const result = await aggregateStream(toStream(commits), 1);

      assert.strictEqual(result.contributions.length, 3);

      const day1 = result.contributions[0]; // 2025-01-15
      assert.strictEqual(day1.count, 2);
      assert.strictEqual(day1.authorDetails.length, 1);
      assert.strictEqual(day1.authorDetails[0].author, 'Alice');
      assert.strictEqual(day1.authorDetails[0].count, 2);
      assert.strictEqual(day1.authorDetails[0].additions, 15);
      assert.strictEqual(day1.authorDetails[0].deletions, 3);

      const day2 = result.contributions[1]; // 2025-01-16
      assert.strictEqual(day2.count, 1);
      assert.strictEqual(day2.authorDetails.length, 1);
      assert.strictEqual(day2.authorDetails[0].author, 'Bob');
      assert.strictEqual(day2.authorDetails[0].count, 1);
      assert.strictEqual(day2.authorDetails[0].additions, 20);
      assert.strictEqual(day2.authorDetails[0].deletions, 3);

      const day3 = result.contributions[2]; // 2025-01-17
      assert.strictEqual(day3.count, 1);
      assert.strictEqual(day3.authorDetails.length, 1);
      assert.strictEqual(day3.authorDetails[0].author, 'Alice');
      assert.strictEqual(day3.authorDetails[0].count, 1);
      assert.strictEqual(day3.authorDetails[0].additions, 3);
      assert.strictEqual(day3.authorDetails[0].deletions, 0);
    });

    it('should have correct per-day byHour data', async () => {
      const result = await aggregateStream(toStream(commits), 1);

      const day1 = result.contributions[0]; // 2025-01-15: 10:00, 11:00
      assert.strictEqual(day1.byHour[10].count, 1);
      assert.strictEqual(day1.byHour[11].count, 1);

      const day2 = result.contributions[1]; // 2025-01-16: 12:00
      assert.strictEqual(day2.byHour[12].count, 1);

      const day3 = result.contributions[2]; // 2025-01-17: 09:00
      assert.strictEqual(day3.byHour[9].count, 1);
    });

    it('should have correct per-day topFiles', async () => {
      const result = await aggregateStream(toStream(commits), 1);

      const day1 = result.contributions[0]; // 2025-01-15
      assert.strictEqual(day1.topFiles.length, 2);
      assert.strictEqual(day1.topFiles[0].path, 'a.js');
      assert.strictEqual(day1.topFiles[0].changes, 1);
      assert.strictEqual(day1.topFiles[1].path, 'b.js');
      assert.strictEqual(day1.topFiles[1].changes, 1);

      const day2 = result.contributions[1]; // 2025-01-16
      assert.strictEqual(day2.topFiles.length, 2);
    });

    it('should have 2 contributors sorted by commit count', async () => {
      const result = await aggregateStream(toStream(commits), 1);

      assert.strictEqual(result.contributors.length, 2);
      assert.strictEqual(result.contributors[0].name, 'Alice');
      assert.strictEqual(result.contributors[0].totalCommits, 3);
      assert.strictEqual(result.contributors[1].name, 'Bob');
      assert.strictEqual(result.contributors[1].totalCommits, 1);
    });
  });

  // ----- e. branchCount as Promise ----------------------------------------

  describe('branchCount as Promise', () => {
    it('should accept a resolved Promise<number> for branchCount', async () => {
      const commits = [makeCommit({ hash: 'b1' }), makeCommit({ hash: 'b2' })];
      const branchCountPromise = Promise.resolve(3);
      const result = await aggregateStream(toStream(commits), branchCountPromise);
      assert.strictEqual(result.summary.activeBranches, 3);
      assert.strictEqual(result.summary.totalCommits, 2);
    });

    it('should work with empty stream and resolved Promise', async () => {
      const branchCountPromise = Promise.resolve(0);
      const result = await aggregateStream(emptyStream(), branchCountPromise);
      assert.strictEqual(result.summary.activeBranches, 0);
      assert.strictEqual(result.summary.totalCommits, 0);
    });

    it('should await a delayed Promise<number>', async () => {
      const commits = [makeCommit({ hash: 'delayed' })];
      const delayedPromise = new Promise((resolve) => {
        setTimeout(() => resolve(5), 10);
      });
      const result = await aggregateStream(toStream(commits), delayedPromise);
      assert.strictEqual(result.summary.activeBranches, 5);
      assert.strictEqual(result.summary.totalCommits, 1);
    });

    it('should produce identical result to aggregate with same branchCount value via Promise', async () => {
      const commits = [
        makeCommit({
          hash: 'p1',
          author: { name: 'Alice', email: 'alice@test.com' },
          date: '2025-01-15T10:00:00Z',
        }),
        makeCommit({
          hash: 'p2',
          author: { name: 'Bob', email: 'bob@test.com' },
          date: '2025-01-16T12:00:00Z',
        }),
      ];
      const sync = aggregate(commits, 7);
      const async_ = await aggregateStream(toStream(commits), Promise.resolve(7));
      assert.deepStrictEqual(async_, sync);
    });
  });

  // ----- f. Stream errors propagate ---------------------------------------

  describe('stream errors propagate', () => {
    it('should reject when the async iterable throws', async () => {
      await assert.rejects(() => aggregateStream(errorStream(), 1), /stream error!/);
    });

    it('should reject for a stream that throws immediately', async () => {
      await assert.rejects(() => aggregateStream(immediateError(), 1), /immediate fail/);
    });

    it('should reject when branchCount Promise rejects', async () => {
      const commits = [makeCommit({ hash: 'reject' })];
      const rejectingPromise = Promise.reject(new Error('branchCount failed'));
      await assert.rejects(
        () => aggregateStream(toStream(commits), rejectingPromise),
        /branchCount failed/,
      );
    });

    it('should not consume the stream further after a rejection mid-stream', async () => {
      let yielded = 0;
      async function* midStreamError() {
        yield makeCommit({ hash: 'ok1' });
        yielded++;
        yield makeCommit({ hash: 'ok2' });
        yielded++;
        throw new Error('mid-stream');
      }
      await assert.rejects(() => aggregateStream(midStreamError(), 1), /mid-stream/);
      // Only 2 commits should have been yielded before the error
      assert.strictEqual(yielded, 2);
    });
  });

  // ----- g. Timing reporting ----------------------------------------------

  describe('timing reporting', () => {
    it('should populate timings array with three sub-steps when passed', async () => {
      const commits = [
        makeCommit({
          hash: 't1',
          author: { name: 'Alice', email: 'alice@test.com' },
          date: '2025-01-15T10:00:00Z',
          stats: { additions: 10, deletions: 2, files: 1 },
          files: ['a.js'],
        }),
      ];
      const timings = [];
      await aggregateStream(toStream(commits), 1, timings);

      assert.strictEqual(timings.length, 3);
      assert.strictEqual(timings[0].label, 'Parse commits');
      assert.strictEqual(timings[1].label, 'Merge contributors');
      assert.strictEqual(timings[2].label, 'Format results');
      for (const entry of timings) {
        assert.ok(typeof entry.elapsed === 'number');
        assert.ok(entry.elapsed >= 0);
      }
    });

    it('should produce same result with and without timings array', async () => {
      const commits = [
        makeCommit({
          hash: 'tw1',
          author: { name: 'Alice', email: 'alice@test.com' },
          date: '2025-01-15T10:00:00Z',
        }),
      ];
      const resultWithout = await aggregateStream(toStream(commits), 1);
      const resultWith = await aggregateStream(toStream(commits), 1, []);

      assert.deepStrictEqual(resultWith, resultWithout);
    });
  });

  // ----- h. Noreply merging works with streams ----------------------------

  describe('noreply merging with streams', () => {
    it('should merge same person when name matches GH username', async () => {
      const commits = [
        makeCommit({
          hash: 'c1',
          author: { name: 'johndoe', email: 'johndoe@gmail.com' },
          date: '2025-01-15T10:00:00Z',
          stats: { additions: 10, deletions: 2, files: 1 },
          files: ['a.js'],
        }),
        makeCommit({
          hash: 'c2',
          author: { name: 'Full Name', email: noreplyEmail('johndoe') },
          date: '2025-01-16T10:00:00Z',
          stats: { additions: 5, deletions: 1, files: 1 },
          files: ['b.js'],
        }),
      ];
      const result = await aggregateStream(toStream(commits), 1);

      assertMergedContributor(result, {
        totalCommits: 2,
        additions: 15,
        deletions: 3,
        email: noreplyEmail('johndoe'),
      });
    });

    it('should merge when email local part matches GH username', async () => {
      const commits = [
        makeCommit({
          hash: 'c1',
          author: { name: 'Some Person', email: 'ghuser@example.com' },
          date: '2025-01-15T10:00:00Z',
          stats: { additions: 10, deletions: 2, files: 1 },
          files: ['a.js'],
        }),
        makeCommit({
          hash: 'c2',
          author: { name: 'Another Name', email: noreplyEmail('ghuser') },
          date: '2025-01-16T10:00:00Z',
          stats: { additions: 5, deletions: 1, files: 1 },
          files: ['b.js'],
        }),
      ];
      const result = await aggregateStream(toStream(commits), 1);

      assertMergedContributor(result, { totalCommits: 2 });
    });

    it('should NOT merge when noreply username does not match', async () => {
      const commits = [
        makeCommit({
          hash: 'k1',
          author: { name: 'GitHub User', email: 'me@githubuser.dev' },
          date: '2025-01-15T10:00:00Z',
        }),
        makeCommit({
          hash: 'k2',
          author: {
            name: 'GitHub User',
            email: noreplyEmail('gituser', '31807746'),
          },
          date: '2025-01-16T10:00:00Z',
        }),
      ];
      const result = await aggregateStream(toStream(commits), 1);

      assert.strictEqual(result.contributors.length, 2);
    });

    it('should merge ID+username format noreply when name matches', async () => {
      const commits = [
        makeCommit({
          hash: 'j1',
          author: { name: 'jjdubski', email: 'jjdubski@company.com' },
          date: '2025-01-15T10:00:00Z',
          stats: { additions: 10, deletions: 2, files: 1 },
          files: ['a.js'],
        }),
        makeCommit({
          hash: 'j2',
          author: {
            name: 'jjdubski',
            email: noreplyEmail('jjdubski', '12345'),
          },
          date: '2025-01-16T10:00:00Z',
          stats: { additions: 5, deletions: 1, files: 1 },
          files: ['b.js'],
        }),
      ];
      const result = await aggregateStream(toStream(commits), 1);

      assertMergedContributor(result, {
        totalCommits: 2,
        additions: 15,
        deletions: 3,
      });
    });

    it('should produce identical noreply merge result to aggregate', async () => {
      const commits = [
        makeCommit({
          hash: 'neq1',
          author: { name: 'johndoe', email: 'johndoe@gmail.com' },
          date: '2025-01-15T10:00:00Z',
          stats: { additions: 10, deletions: 2, files: 1 },
          files: ['a.js'],
        }),
        makeCommit({
          hash: 'neq2',
          author: { name: 'Full Name', email: noreplyEmail('johndoe') },
          date: '2025-01-16T10:00:00Z',
          stats: { additions: 5, deletions: 1, files: 1 },
          files: ['b.js'],
        }),
        makeCommit({
          hash: 'neq3',
          author: { name: 'Alice', email: 'alice@test.com' },
          date: '2025-01-17T10:00:00Z',
        }),
      ];
      const sync = aggregate(commits, 1);
      const async_ = await aggregateStream(toStream(commits), 1);
      assert.deepStrictEqual(async_, sync);
    });
  });
});

// ---------------------------------------------------------------------------
// Tests for aggregateStreamParallel — real git repos
// ---------------------------------------------------------------------------

describe('aggregateStreamParallel (parallel repo processing)', () => {
  /** @type {string} */
  let multiYearRepoPath;
  /** @type {string} */
  let emptyRepoPath;
  /** @type {string} */
  let singleYearRepoPath;
  /** @type {string} */
  let singleCommitRepoPath;
  /** @type {string} */
  let tmpDir;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'insights-test-parallel-'));

    // ── Empty repo ──────────────────────────────────────────────────────
    emptyRepoPath = join(tmpDir, 'empty-repo');
    execSync(`git init "${emptyRepoPath}"`, { stdio: 'pipe' });

    // ── Multi-year repo: commits spanning 2024, 2025, 2026 ──────────────
    multiYearRepoPath = join(tmpDir, 'multi-year-repo');
    execSync(`git init "${multiYearRepoPath}"`, { stdio: 'pipe' });
    execSync('git config user.name "Test User"', { cwd: multiYearRepoPath, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: multiYearRepoPath, stdio: 'pipe' });

    // 2024 — Test User
    writeFileSync(join(multiYearRepoPath, 'file.txt'), '2024\n');
    execSync(
      'git add file.txt && GIT_AUTHOR_DATE="2024-06-15T10:00:00" GIT_COMMITTER_DATE="2024-06-15T10:00:00" git commit -m "Commit in 2024"',
      { cwd: multiYearRepoPath, stdio: 'pipe' },
    );

    // 2025 — Alice (different author)
    writeFileSync(join(multiYearRepoPath, 'alice.txt'), 'alice\n');
    execSync(
      'git add alice.txt file.txt && GIT_AUTHOR_DATE="2025-02-20T14:30:00" GIT_COMMITTER_DATE="2025-02-20T14:30:00" git commit -m "Alice in 2025" --author="Alice <alice@test.com>"',
      { cwd: multiYearRepoPath, stdio: 'pipe' },
    );

    // Another 2025 — Test User
    appendFileSync(join(multiYearRepoPath, 'file.txt'), '2025\n');
    execSync(
      'git add file.txt && GIT_AUTHOR_DATE="2025-08-10T09:15:00" GIT_COMMITTER_DATE="2025-08-10T09:15:00" git commit -m "Second commit in 2025"',
      { cwd: multiYearRepoPath, stdio: 'pipe' },
    );

    // 2026 — Alice
    appendFileSync(join(multiYearRepoPath, 'file.txt'), '2026\n');
    execSync(
      'git add file.txt && GIT_AUTHOR_DATE="2026-01-05T16:00:00" GIT_COMMITTER_DATE="2026-01-05T16:00:00" git commit -m "Alice in 2026" --author="Alice <alice@test.com>"',
      { cwd: multiYearRepoPath, stdio: 'pipe' },
    );

    // ── Single-year repo: all commits in 2025 ────────────────────────────
    singleYearRepoPath = join(tmpDir, 'single-year-repo');
    execSync(`git init "${singleYearRepoPath}"`, { stdio: 'pipe' });
    execSync('git config user.name "Test User"', { cwd: singleYearRepoPath, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: singleYearRepoPath, stdio: 'pipe' });

    writeFileSync(join(singleYearRepoPath, 'a.txt'), 'a\n');
    execSync(
      'git add a.txt && GIT_AUTHOR_DATE="2025-03-01T12:00:00" GIT_COMMITTER_DATE="2025-03-01T12:00:00" git commit -m "First 2025"',
      { cwd: singleYearRepoPath, stdio: 'pipe' },
    );
    writeFileSync(join(singleYearRepoPath, 'b.txt'), 'b\n');
    execSync(
      'git add b.txt && GIT_AUTHOR_DATE="2025-07-15T08:00:00" GIT_COMMITTER_DATE="2025-07-15T08:00:00" git commit -m "Second 2025"',
      { cwd: singleYearRepoPath, stdio: 'pipe' },
    );

    // ── Single-commit repo ───────────────────────────────────────────────
    singleCommitRepoPath = join(tmpDir, 'single-commit-repo');
    execSync(`git init "${singleCommitRepoPath}"`, { stdio: 'pipe' });
    execSync('git config user.name "Test User"', { cwd: singleCommitRepoPath, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: singleCommitRepoPath, stdio: 'pipe' });

    writeFileSync(join(singleCommitRepoPath, 'readme.md'), '# Single\n');
    execSync(
      'git add readme.md && GIT_AUTHOR_DATE="2025-04-10T10:00:00" GIT_COMMITTER_DATE="2025-04-10T10:00:00" git commit -m "Only commit"',
      { cwd: singleCommitRepoPath, stdio: 'pipe' },
    );
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ----- a. Equivalence: multi-year repo -----------------------------------

  it('should produce identical results to aggregateStream for a multi-year repo', async () => {
    const bc = await getLocalBranchCount(multiYearRepoPath);

    const [seq, par] = await Promise.all([
      aggregateStream(getAllCommits(multiYearRepoPath), bc),
      aggregateStreamParallel(multiYearRepoPath, bc),
    ]);

    assert.deepStrictEqual(par, seq);
  });

  // ----- b. Empty repo ----------------------------------------------------

  it('should return empty result for an empty repo', async () => {
    const bc = await getLocalBranchCount(emptyRepoPath);
    const result = await aggregateStreamParallel(emptyRepoPath, bc);

    assert.strictEqual(result.summary.totalCommits, 0);
    assert.strictEqual(result.summary.totalContributors, 0);
    assert.strictEqual(result.summary.totalAdditions, 0);
    assert.strictEqual(result.summary.totalDeletions, 0);
    assert.strictEqual(result.summary.firstCommit, null);
    assert.strictEqual(result.summary.lastCommit, null);
    assert.strictEqual(result.summary.activeBranches, bc);
    assert.deepStrictEqual(result.contributions, []);
    assert.deepStrictEqual(result.contributors, []);
    assert.deepStrictEqual(result.frequency, []);
  });

  // ----- c. Single-year repo ----------------------------------------------

  it('should produce identical results to aggregateStream for a single-year repo', async () => {
    const bc = await getLocalBranchCount(singleYearRepoPath);

    const [seq, par] = await Promise.all([
      aggregateStream(getAllCommits(singleYearRepoPath), bc),
      aggregateStreamParallel(singleYearRepoPath, bc),
    ]);

    assert.deepStrictEqual(par, seq);
  });

  // ----- d. Timing array --------------------------------------------------

  it('should populate timings array with per-slice and merge entries', async () => {
    // Multi-year repo produces quarterly slices, testing the full timing structure
    const bc = await getLocalBranchCount(multiYearRepoPath);
    const timings = [];

    await aggregateStreamParallel(multiYearRepoPath, bc, timings, undefined, {});

    // Should have: per-year entries + 'Merge results' + 'Merge contributors' + 'Format results'
    assert.ok(timings.length >= 5, `expected at least 5 timing entries, got ${timings.length}`);

    const labels = timings.map((t) => t.label);

    // Per-year entries should include each year in order
    const perYearLabels = labels.filter((l) => /^Parse commits \(\d{4}\)$/.test(l));
    assert.ok(perYearLabels.includes('Parse commits (2024)'), 'missing 2024 label');
    assert.ok(perYearLabels.includes('Parse commits (2025)'), 'missing 2025 label');
    assert.ok(perYearLabels.includes('Parse commits (2026)'), 'missing 2026 label');
    // Should be in ascending year order
    const yearNums = perYearLabels.map((l) => Number.parseInt(l.match(/\d{4}/)[0], 10));
    assert.deepStrictEqual(
      yearNums,
      [...yearNums].sort((a, b) => a - b),
      'years should be in ascending order',
    );

    // Overall entries should be present
    assert.ok(labels.includes('Merge results'), 'missing Merge results');
    assert.ok(labels.includes('Merge contributors'), 'missing Merge contributors');
    assert.ok(labels.includes('Format results'), 'missing Format results');

    // All entries should have valid elapsed
    for (const entry of timings) {
      assert.ok(typeof entry.elapsed === 'number', `elapsed should be a number for ${entry.label}`);
      assert.ok(entry.elapsed >= 0, `elapsed should be >= 0 for ${entry.label}`);
    }
  });

  // ----- e. Single commit -------------------------------------------------

  it('should produce identical results to aggregateStream for a single-commit repo', async () => {
    const bc = await getLocalBranchCount(singleCommitRepoPath);

    const [seq, par] = await Promise.all([
      aggregateStream(getAllCommits(singleCommitRepoPath), bc),
      aggregateStreamParallel(singleCommitRepoPath, bc),
    ]);

    assert.deepStrictEqual(par, seq);
  });
});

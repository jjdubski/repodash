import { describe, it } from 'node:test';
import assert from 'node:assert';
import { aggregate, createYearSlices, concurrencyPool } from '../src/aggregate.js';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/**
 * Create a minimal commit object with sensible defaults.
 * Spread overrides *after* defaults so callers can override any field.
 */
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

/**
 * Verify that all five datasets have their "empty" shape.
 * Used after calling aggregate([], branchCount).
 */
function assertEmptyResult(result, branchCount) {
  // -- summary --
  assert.strictEqual(result.summary.totalCommits, 0);
  assert.strictEqual(result.summary.totalContributors, 0);
  assert.strictEqual(result.summary.totalAdditions, 0);
  assert.strictEqual(result.summary.totalDeletions, 0);
  assert.strictEqual(result.summary.firstCommit, null);
  assert.strictEqual(result.summary.lastCommit, null);
  assert.strictEqual(result.summary.activeBranches, branchCount);

  // -- contributions --
  assert.deepStrictEqual(result.contributions, []);

  // -- contributors --
  assert.deepStrictEqual(result.contributors, []);

  // -- frequency --
  assert.deepStrictEqual(result.frequency, []);

  // -- activity --
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
// Tests
// ---------------------------------------------------------------------------

describe('extracted helpers', () => {
  describe('createYearSlices', () => {
    it('should produce 4 quarters for a single year', () => {
      const slices = createYearSlices(2024, 2024);
      assert.strictEqual(slices.length, 4);
      assert.strictEqual(slices[0].after, '2024-01-01');
      assert.strictEqual(slices[0].before, '2024-04-01');
      assert.strictEqual(slices[0].quarterNum, 1);
      assert.strictEqual(slices[1].after, '2024-04-01');
      assert.strictEqual(slices[1].before, '2024-07-01');
      assert.strictEqual(slices[1].quarterNum, 2);
      assert.strictEqual(slices[2].after, '2024-07-01');
      assert.strictEqual(slices[2].before, '2024-10-01');
      assert.strictEqual(slices[2].quarterNum, 3);
      assert.strictEqual(slices[3].after, '2024-10-01');
      assert.strictEqual(slices[3].before, '2025-01-01');
      assert.strictEqual(slices[3].quarterNum, 4);
    });

    it('should produce correct slices for a multi-year range', () => {
      const slices = createYearSlices(2023, 2025);
      assert.strictEqual(slices.length, 12);
      assert.strictEqual(slices[0].after, '2023-01-01');
      assert.strictEqual(slices[0].before, '2023-04-01');
      assert.strictEqual(slices[3].after, '2023-10-01');
      assert.strictEqual(slices[3].before, '2024-01-01');
      assert.strictEqual(slices[4].after, '2024-01-01');
      assert.strictEqual(slices[4].before, '2024-04-01');
      assert.strictEqual(slices[11].after, '2025-10-01');
      assert.strictEqual(slices[11].before, '2026-01-01');
      assert.strictEqual(slices[11].quarterNum, 4);
    });

    it('should wrap Q4 before date to January of the following year', () => {
      for (let year = 2000; year <= 2030; year++) {
        const slices = createYearSlices(year, year);
        const q4 = slices[3];
        assert.strictEqual(q4.quarterNum, 4);
        assert.strictEqual(q4.after, `${year}-10-01`);
        assert.strictEqual(q4.before, `${year + 1}-01-01`);
      }
    });

    it('should produce consecutive non-overlapping date ranges', () => {
      const slices = createYearSlices(2024, 2025);
      for (let i = 0; i < slices.length - 1; i++) {
        assert.strictEqual(slices[i].before, slices[i + 1].after);
      }
    });
  });

  describe('concurrencyPool', () => {
    it('should return an empty array when given no tasks', async () => {
      const results = await concurrencyPool([], 4);
      assert.deepStrictEqual(results, []);
    });

    it('should run all tasks and preserve result order', async () => {
      const tasks = [0, 1, 2, 3, 4].map((n) => () => Promise.resolve(n * 2));
      const results = await concurrencyPool(tasks, 2);
      assert.deepStrictEqual(results, [0, 2, 4, 6, 8]);
    });

    it('should run tasks with limited concurrency', async () => {
      const active = [];
      const maxActive = [];
      const tasks = [10, 30, 50, 70, 90, 110, 130, 150, 170, 190].map(
        (ms) => () =>
          new Promise((resolve) => {
            active.push(ms);
            maxActive.push(active.length);
            setTimeout(() => {
              const idx = active.indexOf(ms);
              if (idx !== -1) active.splice(idx, 1);
              resolve(ms);
            }, ms);
          }),
      );
      const results = await concurrencyPool(tasks, 3);
      assert.deepStrictEqual(results, [10, 30, 50, 70, 90, 110, 130, 150, 170, 190]);
      assert.ok(Math.max(...maxActive) <= 3);
    });

    it('should handle all tasks completing immediately', async () => {
      const tasks = [1, 2, 3, 4, 5].map((n) => () => Promise.resolve(n));
      const results = await concurrencyPool(tasks, 1);
      assert.deepStrictEqual(results, [1, 2, 3, 4, 5]);
    });

    it('should propagate errors from failing tasks', async () => {
      const tasks = [
        () => Promise.resolve(1),
        () => Promise.reject(new Error('task failed')),
        () => Promise.resolve(3),
      ];
      await assert.rejects(() => concurrencyPool(tasks, 2), /task failed/);
    });

    it('should handle limit larger than task count', async () => {
      const tasks = [1, 2, 3].map((n) => () => Promise.resolve(n));
      const results = await concurrencyPool(tasks, 100);
      assert.deepStrictEqual(results, [1, 2, 3]);
    });
  });
});

describe('aggregate (pure function)', () => {
  // ----- 1. Empty commits ------------------------------------------------

  describe('empty commits', () => {
    it('should return all zeros and empty arrays (branchCount = 1)', () => {
      const result = aggregate([], 1);
      assertEmptyResult(result, 1);
    });

    it('should return all zeros and empty arrays (branchCount = 0)', () => {
      const result = aggregate([], 0);
      assertEmptyResult(result, 0);
    });

    it('should return all zeros and empty arrays (branchCount = 42)', () => {
      const result = aggregate([], 42);
      assertEmptyResult(result, 42);
    });
  });

  // ----- 2. Single commit ------------------------------------------------

  describe('single commit', () => {
    const commit = makeCommit({ hash: 'single1' });
    const result = aggregate([commit], 1);

    it('should have correct summary totals', () => {
      assert.strictEqual(result.summary.totalCommits, 1);
      assert.strictEqual(result.summary.totalContributors, 1);
      assert.strictEqual(result.summary.totalAdditions, 10);
      assert.strictEqual(result.summary.totalDeletions, 5);
      assert.strictEqual(result.summary.firstCommit, commit.date);
      assert.strictEqual(result.summary.lastCommit, commit.date);
      assert.strictEqual(result.summary.activeBranches, 1);
    });

    it('should have contributions with 1 entry', () => {
      assert.strictEqual(result.contributions.length, 1);
      assert.strictEqual(result.contributions[0].date, '2025-01-15');
      assert.strictEqual(result.contributions[0].count, 1);
      assert.strictEqual(result.contributions[0].authorDetails.length, 1);
      assert.strictEqual(result.contributions[0].authorDetails[0].author, 'Test User');
      assert.strictEqual(result.contributions[0].authorDetails[0].count, 1);
      assert.strictEqual(result.contributions[0].authorDetails[0].additions, 10);
      assert.strictEqual(result.contributions[0].authorDetails[0].deletions, 5);
    });

    it('should have contributors with 1 entry and correct stats', () => {
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

    it('should have frequency with 1 entry', () => {
      assert.strictEqual(result.frequency.length, 1);
      assert.strictEqual(result.frequency[0].date, '2025-01-15');
      assert.strictEqual(result.frequency[0].additions, 10);
      assert.strictEqual(result.frequency[0].deletions, 5);
    });

    it('should have 7 day-of-week entries with correct day set', () => {
      // 2025-01-15 is a Wednesday  (jsDay=3 → mapDayOfWeek(3)=(3+6)%7=2 → 'Wed')
      assert.strictEqual(result.activity.byDayOfWeek.length, 7);
      const dayNames = result.activity.byDayOfWeek.map((d) => d.day);
      assert.deepStrictEqual(dayNames, ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
      // Wednesday should have count 1, all others 0
      for (let i = 0; i < 7; i++) {
        const expected = i === 2 ? 1 : 0;
        assert.strictEqual(
          result.activity.byDayOfWeek[i].count,
          expected,
          `dayOfWeek[${i}] (${result.activity.byDayOfWeek[i].day}) count mismatch`,
        );
      }
    });

    it('should have 24 hour entries with correct hour set', () => {
      // date is 10:30 UTC → hour 10
      assert.strictEqual(result.activity.byHour.length, 24);
      for (let i = 0; i < 24; i++) {
        const expected = i === 10 ? 1 : 0;
        assert.strictEqual(result.activity.byHour[i].count, expected, `hour[${i}] count mismatch`);
        assert.strictEqual(result.activity.byHour[i].hour, i);
      }
    });

    it('should have topFiles from the commit files', () => {
      // Default commit touches 2 files
      assert.strictEqual(result.activity.topFiles.length, 2);
      // Sorted by changes desc (both have 1)
      const paths = result.activity.topFiles.map((f) => f.path);
      assert.deepStrictEqual(paths, ['src/file1.js', 'src/file2.js']);
      for (const f of result.activity.topFiles) {
        assert.strictEqual(f.changes, 1);
      }
    });

    it('should include email field in authorDetails', () => {
      assert.strictEqual(result.contributions[0].authorDetails[0].email, 'test@test.com');
      assert.strictEqual(result.contributions[0].authorDetails[0].author, 'Test User');
    });

    it('should include per-day byHour in contributions', () => {
      const day = result.contributions[0];
      assert.strictEqual(day.byHour.length, 24);
      for (let i = 0; i < 24; i++) {
        const expected = i === 10 ? 1 : 0;
        assert.strictEqual(
          day.byHour[i].count,
          expected,
          `contributions[0].byHour[${i}] count mismatch`,
        );
      }
    });

    it('should include per-day topFiles in contributions', () => {
      const day = result.contributions[0];
      assert.strictEqual(day.topFiles.length, 2);
      assert.strictEqual(day.topFiles[0].path, 'src/file1.js');
      assert.strictEqual(day.topFiles[0].changes, 1);
      assert.strictEqual(day.topFiles[1].path, 'src/file2.js');
      assert.strictEqual(day.topFiles[1].changes, 1);
    });
  });

  // ----- 3. Same day, different authors -----------------------------------

  describe('multiple commits — same day, different authors', () => {
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
        date: '2025-01-15T12:00:00Z',
        stats: { additions: 20, deletions: 3, files: 2 },
        files: ['c.js', 'd.js'],
      }),
      makeCommit({
        hash: 'c4',
        author: { name: 'Alice', email: 'alice@test.com' },
        date: '2025-01-16T10:00:00Z',
        stats: { additions: 3, deletions: 0, files: 1 },
        files: ['e.js'],
      }),
    ];

    const result = aggregate(commits, 1);

    it('should have correct summary', () => {
      assert.strictEqual(result.summary.totalCommits, 4);
      assert.strictEqual(result.summary.totalContributors, 2); // 2 unique names
      assert.strictEqual(result.summary.totalAdditions, 10 + 5 + 20 + 3);
      assert.strictEqual(result.summary.totalDeletions, 2 + 1 + 3 + 0);
      assert.strictEqual(result.summary.firstCommit, '2025-01-15T10:00:00Z');
      assert.strictEqual(result.summary.lastCommit, '2025-01-16T10:00:00Z');
    });

    it('should have 2 contribution day entries sorted by date', () => {
      assert.strictEqual(result.contributions.length, 2);
      assert.strictEqual(result.contributions[0].date, '2025-01-15');
      assert.strictEqual(result.contributions[1].date, '2025-01-16');
    });

    it('should break down contributions by author sorted by count desc', () => {
      const day1 = result.contributions[0]; // 2025-01-15
      assert.strictEqual(day1.count, 3);
      assert.strictEqual(day1.authorDetails.length, 2);
      // Alice has 2 commits, Bob has 1 → Alice first
      assert.strictEqual(day1.authorDetails[0].author, 'Alice');
      assert.strictEqual(day1.authorDetails[0].count, 2);
      assert.strictEqual(day1.authorDetails[0].additions, 15);
      assert.strictEqual(day1.authorDetails[0].deletions, 3);
      assert.strictEqual(day1.authorDetails[1].author, 'Bob');
      assert.strictEqual(day1.authorDetails[1].count, 1);
      assert.strictEqual(day1.authorDetails[1].additions, 20);
      assert.strictEqual(day1.authorDetails[1].deletions, 3);

      const day2 = result.contributions[1]; // 2025-01-16
      assert.strictEqual(day2.count, 1);
      assert.strictEqual(day2.authorDetails.length, 1);
      assert.strictEqual(day2.authorDetails[0].author, 'Alice');
      assert.strictEqual(day2.authorDetails[0].count, 1);
      assert.strictEqual(day2.authorDetails[0].additions, 3);
      assert.strictEqual(day2.authorDetails[0].deletions, 0);
    });

    it('should aggregate per-day byHour correctly across multiple commits', () => {
      const day1 = result.contributions[0]; // 2025-01-15: 3 commits at 10, 11, 12
      assert.strictEqual(day1.byHour.length, 24);
      assert.strictEqual(day1.byHour[10].count, 1);
      assert.strictEqual(day1.byHour[11].count, 1);
      assert.strictEqual(day1.byHour[12].count, 1);
      // all other hours should be 0
      for (let i = 0; i < 24; i++) {
        if (i !== 10 && i !== 11 && i !== 12) {
          assert.strictEqual(day1.byHour[i].count, 0, `day1 hour ${i} should be 0`);
        }
      }
    });

    it('should aggregate per-day topFiles correctly across multiple commits', () => {
      const day1 = result.contributions[0]; // 2025-01-15
      assert.strictEqual(day1.topFiles.length, 4);
      const day1Paths = day1.topFiles.map((f) => f.path);
      assert.deepStrictEqual(day1Paths, ['a.js', 'b.js', 'c.js', 'd.js']);
      for (const f of day1.topFiles) {
        assert.strictEqual(f.changes, 1, `${f.path} should have 1 change`);
      }

      const day2 = result.contributions[1]; // 2025-01-16
      assert.strictEqual(day2.topFiles.length, 1);
      assert.strictEqual(day2.topFiles[0].path, 'e.js');
      assert.strictEqual(day2.topFiles[0].changes, 1);
    });

    it('should have 2 contributors sorted by commit count desc', () => {
      assert.strictEqual(result.contributors.length, 2);
      // Alice (3 commits) before Bob (1 commit)
      assert.strictEqual(result.contributors[0].name, 'Alice');
      assert.strictEqual(result.contributors[0].totalCommits, 3);
      assert.strictEqual(result.contributors[1].name, 'Bob');
      assert.strictEqual(result.contributors[1].totalCommits, 1);
    });

    it('should have correct per-contributor stats', () => {
      const alice = result.contributors[0];
      const bob = result.contributors[1];
      assert.strictEqual(alice.additions, 10 + 5 + 3);
      assert.strictEqual(alice.deletions, 2 + 1 + 0);
      assert.strictEqual(alice.firstCommit, '2025-01-15T10:00:00Z');
      assert.strictEqual(alice.lastCommit, '2025-01-16T10:00:00Z');

      assert.strictEqual(bob.additions, 20);
      assert.strictEqual(bob.deletions, 3);
      assert.strictEqual(bob.firstCommit, '2025-01-15T12:00:00Z');
      assert.strictEqual(bob.lastCommit, '2025-01-15T12:00:00Z');
    });
  });

  // ----- 4. Different days ------------------------------------------------

  describe('multiple commits — different days', () => {
    const commits = [
      makeCommit({
        hash: 'd1',
        date: '2025-01-15T10:00:00Z',
        stats: { additions: 10, deletions: 5, files: 1 },
        files: ['x.js'],
      }),
      makeCommit({
        hash: 'd2',
        date: '2025-01-16T10:00:00Z',
        stats: { additions: 20, deletions: 3, files: 1 },
        files: ['y.js'],
      }),
      makeCommit({
        hash: 'd3',
        date: '2025-01-18T10:00:00Z',
        stats: { additions: 5, deletions: 1, files: 1 },
        files: ['z.js'],
      }),
    ];

    const result = aggregate(commits, 1);

    it('should have 3 frequency entries sorted by date', () => {
      assert.strictEqual(result.frequency.length, 3);
      assert.strictEqual(result.frequency[0].date, '2025-01-15');
      assert.strictEqual(result.frequency[1].date, '2025-01-16');
      assert.strictEqual(result.frequency[2].date, '2025-01-18');
    });

    it('should have correct per-day additions and deletions', () => {
      assert.strictEqual(result.frequency[0].additions, 10);
      assert.strictEqual(result.frequency[0].deletions, 5);
      assert.strictEqual(result.frequency[1].additions, 20);
      assert.strictEqual(result.frequency[1].deletions, 3);
      assert.strictEqual(result.frequency[2].additions, 5);
      assert.strictEqual(result.frequency[2].deletions, 1);
    });

    it('should have contributions with non-consecutive dates', () => {
      // 2025-01-17 is skipped
      const dates = result.contributions.map((c) => c.date);
      assert.deepStrictEqual(dates, ['2025-01-15', '2025-01-16', '2025-01-18']);
    });
  });

  // ----- 5. Activity patterns --------------------------------------------

  describe('activity patterns', () => {
    // Dates and their properties:
    //   2025-01-20  Mon  (jsDay=1 → idx 0)  09:00 UTC
    //   2025-01-20  Mon  (jsDay=1 → idx 0)  10:00 UTC
    //   2025-01-21  Tue  (jsDay=2 → idx 1)  14:00 UTC
    //   2025-01-22  Wed  (jsDay=3 → idx 2)  09:00 UTC
    //   2025-01-15  Wed  (jsDay=3 → idx 2)  15:00 UTC
    const commits = [
      makeCommit({
        hash: 'a1',
        date: '2025-01-20T09:00:00Z',
        files: ['src/file1.js', 'src/file2.js'],
      }),
      makeCommit({
        hash: 'a2',
        date: '2025-01-20T10:00:00Z',
        files: ['src/file1.js'],
      }),
      makeCommit({
        hash: 'a3',
        date: '2025-01-21T14:00:00Z',
        files: ['src/file3.js', 'src/file1.js'],
      }),
      makeCommit({
        hash: 'a4',
        date: '2025-01-22T09:00:00Z',
        files: ['src/file2.js', 'src/file4.js'],
      }),
      makeCommit({
        hash: 'a5',
        date: '2025-01-15T15:00:00Z',
        files: ['src/file1.js', 'src/file5.js', 'src/file3.js'],
      }),
    ];

    const result = aggregate(commits, 1);

    it('should count day-of-week correctly (Mon=0 .. Sun=6)', () => {
      const dow = result.activity.byDayOfWeek;
      // Mon=2, Tue=1, Wed=2, Thu=0, Fri=0, Sat=0, Sun=0
      assert.strictEqual(dow[0].day, 'Mon');
      assert.strictEqual(dow[0].count, 2);
      assert.strictEqual(dow[1].day, 'Tue');
      assert.strictEqual(dow[1].count, 1);
      assert.strictEqual(dow[2].day, 'Wed');
      assert.strictEqual(dow[2].count, 2);
      assert.strictEqual(dow[3].day, 'Thu');
      assert.strictEqual(dow[3].count, 0);
      assert.strictEqual(dow[4].day, 'Fri');
      assert.strictEqual(dow[4].count, 0);
      assert.strictEqual(dow[5].day, 'Sat');
      assert.strictEqual(dow[5].count, 0);
      assert.strictEqual(dow[6].day, 'Sun');
      assert.strictEqual(dow[6].count, 0);
    });

    it('should count hours correctly (0-23)', () => {
      const hours = result.activity.byHour;
      assert.strictEqual(hours[9].hour, 9);
      assert.strictEqual(hours[9].count, 2); // 09:00 UTC (commits a1, a4)
      assert.strictEqual(hours[10].hour, 10);
      assert.strictEqual(hours[10].count, 1); // 10:00 UTC (commit a2)
      assert.strictEqual(hours[14].hour, 14);
      assert.strictEqual(hours[14].count, 1); // 14:00 UTC (commit a3)
      assert.strictEqual(hours[15].hour, 15);
      assert.strictEqual(hours[15].count, 1); // 15:00 UTC (commit a5)
      // All other hours should be 0
      for (let i = 0; i < 24; i++) {
        if (![9, 10, 14, 15].includes(i)) {
          assert.strictEqual(hours[i].count, 0, `hour ${i} should be 0`);
        }
      }
    });

    it('should return topFiles sorted by change count desc (max 10)', () => {
      // file changes:
      //   src/file1.js: a1(1) + a2(1) + a3(1) + a5(1) = 4
      //   src/file2.js: a1(1) + a4(1)                   = 2
      //   src/file3.js: a3(1) + a5(1)                   = 2
      //   src/file4.js: a4(1)                           = 1
      //   src/file5.js: a5(1)                           = 1
      // Sorted desc: file1(4), file2(2), file3(2), file4(1), file5(1)
      const topFiles = result.activity.topFiles;
      assert.strictEqual(topFiles.length, 5); // fewer than 10 → all returned

      assert.strictEqual(topFiles[0].path, 'src/file1.js');
      assert.strictEqual(topFiles[0].changes, 4);

      assert.strictEqual(topFiles[1].path, 'src/file2.js');
      assert.strictEqual(topFiles[1].changes, 2);

      assert.strictEqual(topFiles[2].path, 'src/file3.js');
      assert.strictEqual(topFiles[2].changes, 2);

      assert.strictEqual(topFiles[3].path, 'src/file4.js');
      assert.strictEqual(topFiles[3].changes, 1);

      assert.strictEqual(topFiles[4].path, 'src/file5.js');
      assert.strictEqual(topFiles[4].changes, 1);
    });

    it('should never return more than 30 files', () => {
      // Generate enough commits to exceed 30 unique files
      const manyFiles = Array.from({ length: 35 }, (_, i) =>
        makeCommit({
          hash: `mf${i}`,
          files: [`file${i}.js`],
          stats: { additions: 1, deletions: 0, files: 1 },
        }),
      );
      const r = aggregate(manyFiles, 1);
      assert.strictEqual(r.activity.topFiles.length, 30);
    });
  });

  // ----- 6. Edge cases ----------------------------------------------------

  describe('edge cases', () => {
    it('should handle a merge commit with zero stats and no files', () => {
      const mergeCommit = makeCommit({
        hash: 'merge1',
        stats: { additions: 0, deletions: 0, files: 0 },
        files: [],
        message: 'Merge branch feature-x',
      });
      const result = aggregate([mergeCommit], 1);

      assert.strictEqual(result.summary.totalCommits, 1);
      assert.strictEqual(result.summary.totalAdditions, 0);
      assert.strictEqual(result.summary.totalDeletions, 0);
      assert.strictEqual(result.frequency[0].additions, 0);
      assert.strictEqual(result.frequency[0].deletions, 0);
      assert.deepStrictEqual(result.activity.topFiles, []);
    });

    it('should handle a merge commit with non-zero stats (conflict resolution)', () => {
      const mergeCommit = makeCommit({
        hash: 'mergeConflict1',
        stats: { additions: 42, deletions: 17, files: 3 },
        files: ['src/conflict.js', 'src/resolved.js', 'src/merged.js'],
        message: 'Merge branch feature-y with conflict resolution',
      });
      const result = aggregate([mergeCommit], 1);

      assert.strictEqual(result.summary.totalCommits, 1);
      assert.strictEqual(result.summary.totalAdditions, 42);
      assert.strictEqual(result.summary.totalDeletions, 17);
      assert.strictEqual(result.frequency[0].additions, 42);
      assert.strictEqual(result.frequency[0].deletions, 17);
      assert.strictEqual(result.activity.topFiles.length, 3);
      // Each file changed once
      for (const f of result.activity.topFiles) {
        assert.strictEqual(f.changes, 1);
      }
    });

    it('should handle very long file paths', () => {
      const longPath =
        'src/this/is/a/very/deep/nested/directory/structure/that/' +
        'contains/a/file/with/a/really/really/long/path/that/might/' +
        'cause/issues/in/some/systems/but/should/be/fine/here/very_long_filename_with_lots_of_characters.js';
      const commit = makeCommit({
        hash: 'long1',
        files: [longPath],
      });
      const result = aggregate([commit], 1);

      assert.strictEqual(result.activity.topFiles.length, 1);
      assert.strictEqual(result.activity.topFiles[0].path, longPath);
      assert.strictEqual(result.activity.topFiles[0].changes, 1);
    });

    it('should keep different emails as separate contributors', () => {
      const commits = [
        makeCommit({
          hash: 'c1',
          author: { name: 'Test User', email: 'old@test.com' },
          date: '2025-01-15T10:00:00Z',
        }),
        makeCommit({
          hash: 'c2',
          author: { name: 'Test User', email: 'new@test.com' },
          date: '2025-01-16T10:00:00Z',
        }),
      ];
      const result = aggregate(commits, 1);

      // Two contributors (different emails)
      assert.strictEqual(result.contributors.length, 2);
      assert.strictEqual(result.contributors[0].totalCommits, 1);
      assert.strictEqual(result.contributors[1].totalCommits, 1);
      const emails = result.contributors
        .map(function (c) {
          return c.email;
        })
        .sort((a, b) => a.localeCompare(b));
      assert.deepStrictEqual(emails, ['new@test.com', 'old@test.com']);
    });

    it('should merge same email with different names preferring most-used name', () => {
      const commits = [
        makeCommit({
          hash: 'c1',
          author: { name: 'Bob', email: 'bob@test.com' },
          date: '2025-01-15T10:00:00Z',
        }),
        makeCommit({
          hash: 'c2',
          author: { name: 'Robert', email: 'bob@test.com' },
          date: '2025-01-16T10:00:00Z',
        }),
        makeCommit({
          hash: 'c3',
          author: { name: 'Bob', email: 'bob@test.com' },
          date: '2025-01-17T10:00:00Z',
        }),
      ];
      const result = aggregate(commits, 1);

      // One contributor (same email)
      assert.strictEqual(result.contributors.length, 1);
      assert.strictEqual(result.contributors[0].totalCommits, 3);
      // Most-used name is Bob (2 commits) vs Robert (1 commit)
      assert.strictEqual(result.contributors[0].name, 'Bob');
      assert.strictEqual(result.contributors[0].email, 'bob@test.com');
    });

    it('should handle branchCount = 0 with commits present', () => {
      const result = aggregate([makeCommit({ hash: 'b0' })], 0);
      assert.strictEqual(result.summary.activeBranches, 0);
      assert.strictEqual(result.summary.totalCommits, 1);
    });
  });

  // ----- 7. GitHub noreply email merging ----------------------------------

  describe('GitHub noreply email merging', () => {
    it('should merge same person when name matches GH username from noreply email', () => {
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
      const result = aggregate(commits, 1);

      assertMergedContributor(result, {
        totalCommits: 2,
        additions: 15,
        deletions: 3,
        email: noreplyEmail('johndoe'),
      });
    });

    it('should not merge when noreply username matches no other contributor', () => {
      const commits = [
        makeCommit({
          hash: 'c1',
          author: { name: 'Alice', email: 'alice@test.com' },
          date: '2025-01-15T10:00:00Z',
        }),
        makeCommit({
          hash: 'c2',
          author: { name: 'bobsmith', email: noreplyEmail('bobsmith') },
          date: '2025-01-16T10:00:00Z',
        }),
      ];
      const result = aggregate(commits, 1);

      // Two separate contributors — no overlap
      assert.strictEqual(result.contributors.length, 2);
    });

    it('should merge when email local part matches GH username from noreply', () => {
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
      const result = aggregate(commits, 1);

      assertMergedContributor(result, { totalCommits: 2 });
    });

    it('should merge contributions from the same day', () => {
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
          author: { name: 'johndoe', email: noreplyEmail('johndoe') },
          date: '2025-01-15T14:00:00Z',
          stats: { additions: 5, deletions: 1, files: 1 },
          files: ['b.js'],
        }),
      ];
      const result = aggregate(commits, 1);

      assertMergedContributor(result, { totalCommits: 2 });

      // One day, author should be the target name
      assert.strictEqual(result.contributions.length, 1);
      const day = result.contributions[0];
      assert.strictEqual(day.authorDetails.length, 1);
      // The noreply email contributor's best name
      assert.strictEqual(day.authorDetails[0].count, 2);
    });

    it('should merge case-insensitively when GH username differs in case from author name', () => {
      const commits = [
        makeCommit({
          hash: 'c1',
          author: { name: 'Jake', email: 'Jake@gmail.com' },
          date: '2025-01-15T10:00:00Z',
          stats: { additions: 10, deletions: 2, files: 1 },
          files: ['a.js'],
        }),
        makeCommit({
          hash: 'c2',
          author: { name: 'Jake', email: noreplyEmail('jake') },
          date: '2025-01-16T10:00:00Z',
          stats: { additions: 5, deletions: 1, files: 1 },
          files: ['b.js'],
        }),
      ];
      const result = aggregate(commits, 1);

      assertMergedContributor(result, { totalCommits: 2 });
    });

    it('should reflect correct totalContributors in summary after merge', () => {
      const commits = [
        makeCommit({
          hash: 'c1',
          author: { name: 'johndoe', email: 'johndoe@gmail.com' },
          date: '2025-01-15T10:00:00Z',
        }),
        makeCommit({
          hash: 'c2',
          author: { name: 'johndoe', email: noreplyEmail('johndoe') },
          date: '2025-01-16T10:00:00Z',
        }),
        makeCommit({
          hash: 'c3',
          author: { name: 'Alice', email: 'alice@test.com' },
          date: '2025-01-17T10:00:00Z',
        }),
      ];
      const result = aggregate(commits, 1);

      assert.strictEqual(result.summary.totalCommits, 3);
      // johndoe merged into one, plus Alice = 2 contributors
      assert.strictEqual(result.summary.totalContributors, 2);
    });

    it('should merge when email local part matches GH username from noreply (gituser@company.com vs 31807746+gituser@users.noreply.github.com)', () => {
      const commits = [
        makeCommit({
          hash: 'm1',
          author: { name: 'GitHub User', email: 'gituser@company.com' },
          date: '2025-01-15T10:00:00Z',
          stats: { additions: 10, deletions: 2, files: 1 },
          files: ['a.js'],
        }),
        makeCommit({
          hash: 'm2',
          author: {
            name: 'GitHub User',
            email: noreplyEmail('gituser', '31807746'),
          },
          date: '2025-01-16T10:00:00Z',
          stats: { additions: 5, deletions: 1, files: 1 },
          files: ['b.js'],
        }),
      ];
      const result = aggregate(commits, 1);

      assertMergedContributor(result, {
        totalCommits: 2,
        additions: 15,
        deletions: 3,
      });
    });

    it('should NOT merge when noreply username does not match name or email local part (GitHub User case: me@kevco.dev vs 31807746+gituser@users.noreply.github.com)', () => {
      const commits = [
        makeCommit({
          hash: 'k1',
          author: { name: 'GitHub User', email: 'me@gituser.dev' },
          date: '2025-01-15T10:00:00Z',
          stats: { additions: 10, deletions: 2, files: 1 },
          files: ['a.js'],
        }),
        makeCommit({
          hash: 'k2',
          author: {
            name: 'GitHub User',
            email: noreplyEmail('gituser', '31807746'),
          },
          date: '2025-01-16T10:00:00Z',
          stats: { additions: 5, deletions: 1, files: 1 },
          files: ['b.js'],
        }),
      ];
      const result = aggregate(commits, 1);

      // Name "GitHub User" does not match "gituser",
      // email local part "me" does not match "gituser"
      assert.strictEqual(result.contributors.length, 2);
    });

    it('should merge ID+username noreply format (12345+jjdubski@users.noreply.github.com) when name matches extracted username', () => {
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
      const result = aggregate(commits, 1);

      assertMergedContributor(result, {
        totalCommits: 2,
        additions: 15,
        deletions: 3,
      });
    });
  });

  // ----- Structural invariants -------------------------------------------

  describe('structural invariants', () => {
    it('should return exactly 5 top-level keys', () => {
      const result = aggregate([makeCommit({ hash: 'inv1' })], 1);
      assert.deepStrictEqual(
        Object.keys(result).sort((a, b) => a.localeCompare(b)),
        ['activity', 'contributions', 'contributors', 'frequency', 'summary'],
      );
    });

    it('should have consistent totals across datasets', () => {
      const commits = [
        makeCommit({
          hash: 's1',
          date: '2025-01-15T10:00:00Z',
          stats: { additions: 10, deletions: 5, files: 2 },
        }),
        makeCommit({
          hash: 's2',
          date: '2025-01-16T10:00:00Z',
          stats: { additions: 20, deletions: 3, files: 1 },
        }),
      ];
      const result = aggregate(commits, 1);

      // Total additions should match sum of contributions' additions
      const freqAdditions = result.frequency.reduce((sum, d) => sum + d.additions, 0);
      assert.strictEqual(result.summary.totalAdditions, freqAdditions);

      // Total deletions should match sum of frequency deletions
      const freqDeletions = result.frequency.reduce((sum, d) => sum + d.deletions, 0);
      assert.strictEqual(result.summary.totalDeletions, freqDeletions);

      // Total commits should equal sum of all contribution counts
      const contribCommits = result.contributions.reduce((sum, d) => sum + d.count, 0);
      assert.strictEqual(result.summary.totalCommits, contribCommits);

      // Contributors' total additions should match summary total additions
      const contribAdditions = result.contributors.reduce((s, c) => s + c.additions, 0);
      assert.strictEqual(result.summary.totalAdditions, contribAdditions);

      // Contributors' total commits should match summary total commits
      const contribTotalCommits = result.contributors.reduce((s, c) => s + c.totalCommits, 0);
      assert.strictEqual(result.summary.totalCommits, contribTotalCommits);
    });

    it('should not mutate the input array', () => {
      const commits = [makeCommit({ hash: 'mut1' }), makeCommit({ hash: 'mut2' })];
      const frozen = structuredClone(commits);
      aggregate(commits, 1);
      assert.deepStrictEqual(commits, frozen);
    });

    it('should produce the same results with unsorted (non-chronological) commit input', () => {
      // Fixture of 5 known commits in chronological order, with unique
      // per-contributor commit counts and per-file change counts to avoid
      // tie-breaking non-determinism.
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
          author: { name: 'Bob', email: 'bob@test.com' },
          date: '2025-01-14T16:00:00Z',
          stats: { additions: 8, deletions: 4, files: 1 },
          files: ['d.js'],
        }),
        makeCommit({
          hash: 'u5',
          author: { name: 'Charlie', email: 'charlie@test.com' },
          date: '2025-01-15T11:00:00Z',
          stats: { additions: 15, deletions: 2, files: 1 },
          files: ['e.js'],
        }),
        makeCommit({
          hash: 'u6',
          author: { name: 'Charlie', email: 'charlie@test.com' },
          date: '2025-01-16T10:00:00Z',
          stats: { additions: 3, deletions: 1, files: 1 },
          files: ['f.js'],
        }),
      ];

      // Sorted by date ascending — the expected invariant result
      const sortedResult = aggregate(commits, 1);

      // Shuffle: reverse order
      const shuffled = [...commits].reverse();
      const shuffledResult = aggregate(shuffled, 1);

      assert.deepStrictEqual(shuffledResult, sortedResult);
    });

    it('should return the same result when called twice with the same input', () => {
      const commits = [
        makeCommit({ hash: 'det1', date: '2025-01-15T10:00:00Z' }),
        makeCommit({ hash: 'det2', date: '2025-01-16T10:00:00Z' }),
      ];
      const a = aggregate(commits, 2);
      const b = aggregate(commits, 2);
      assert.deepStrictEqual(a, b);
    });

    it('should aggregate 5000 commits in under 500ms', () => {
      const largeSet = Array.from({ length: 5000 }, (_, i) =>
        makeCommit({
          hash: `perf${i}`,
          author: {
            name: `User${i % 50}`,
            email: `user${i % 50}@test.com`,
          },
          date: new Date(Date.UTC(2025, 0, 1) + i * 3600000).toISOString(),
          stats: { additions: i % 20, deletions: i % 10, files: 1 },
          files: [`src/file${i % 100}.js`],
        }),
      );

      const start = performance.now();
      const result = aggregate(largeSet, 5);
      const elapsed = performance.now() - start;

      assert.ok(elapsed < 500, `Took ${elapsed.toFixed(1)}ms, expected under 500ms`);
      // Sanity check that we got real results
      assert.strictEqual(result.summary.totalCommits, 5000);
      assert.ok(result.summary.totalContributors > 0);
    });
  });

  // ----- 9. Per-email tracking in authorDetails ----------------------------

  describe('per-email tracking in authorDetails', () => {
    it('should create separate authorDetails entries for same name with different emails on the same day', () => {
      const commits = [
        makeCommit({
          hash: 'c1',
          author: { name: 'Test User', email: 'old@test.com' },
          date: '2025-01-15T10:00:00Z',
          stats: { additions: 10, deletions: 2, files: 1 },
          files: ['a.js'],
        }),
        makeCommit({
          hash: 'c2',
          author: { name: 'Test User', email: 'new@test.com' },
          date: '2025-01-15T14:00:00Z',
          stats: { additions: 5, deletions: 1, files: 1 },
          files: ['b.js'],
        }),
      ];
      const result = aggregate(commits, 1);

      // 2 separate contributors (different emails)
      assert.strictEqual(result.contributors.length, 2);

      // 1 contribution day with 2 authorDetails entries
      assert.strictEqual(result.contributions.length, 1);
      assert.strictEqual(result.contributions[0].authorDetails.length, 2);

      const details = result.contributions[0].authorDetails;

      // Both have count 1 and same name — stable sort preserves Map insertion order
      const oldEntry = details.find((d) => d.email === 'old@test.com');
      const newEntry = details.find((d) => d.email === 'new@test.com');
      assert.ok(oldEntry);
      assert.ok(newEntry);

      assert.strictEqual(oldEntry.author, 'Test User');
      assert.strictEqual(oldEntry.count, 1);
      assert.strictEqual(oldEntry.additions, 10);
      assert.strictEqual(oldEntry.deletions, 2);

      assert.strictEqual(newEntry.author, 'Test User');
      assert.strictEqual(newEntry.count, 1);
      assert.strictEqual(newEntry.additions, 5);
      assert.strictEqual(newEntry.deletions, 1);

      // Each contributor should have their own stats (not merged)
      const emails = result.contributors.map((c) => c.email).sort((a, b) => a.localeCompare(b));
      assert.deepStrictEqual(emails, ['new@test.com', 'old@test.com']);
    });

    it('should keep same name with different regular emails as separate contributors in summary', () => {
      const commits = [
        makeCommit({
          hash: 's1',
          author: { name: 'jake123', email: 'jake123@aol.com' },
          date: '2025-01-15T10:00:00Z',
          stats: { additions: 10, deletions: 2, files: 1 },
          files: ['a.js'],
        }),
        makeCommit({
          hash: 's2',
          author: { name: 'jake123', email: 'jake123@gmail.com' },
          date: '2025-01-16T10:00:00Z',
          stats: { additions: 5, deletions: 1, files: 1 },
          files: ['b.js'],
        }),
      ];
      const result = aggregate(commits, 1);

      // 2 separate contributors
      assert.strictEqual(result.contributors.length, 2);
      assert.strictEqual(result.summary.totalContributors, 2);

      // Each contributor has their own per-email stats
      const c1 = result.contributors.find((c) => c.email === 'jake123@aol.com');
      const c2 = result.contributors.find((c) => c.email === 'jake123@gmail.com');
      assert.ok(c1);
      assert.ok(c2);
      assert.strictEqual(c1.totalCommits, 1);
      assert.strictEqual(c1.additions, 10);
      assert.strictEqual(c1.deletions, 2);
      assert.strictEqual(c2.totalCommits, 1);
      assert.strictEqual(c2.additions, 5);
      assert.strictEqual(c2.deletions, 1);
    });
  });
});

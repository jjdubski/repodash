import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ---------------------------------------------------------------------------
// Fixture repository paths (set during before())
// ---------------------------------------------------------------------------
/** @type {string} */
let repoWithCommits;
/** @type {string} */
let emptyRepo;
/** @type {string} */
let tmpDir;

// ---------------------------------------------------------------------------
// Module under test — imported once in before() and reused by all tests
// ---------------------------------------------------------------------------
/** @type {import('../src/git.js').getAllCommits} */
let getAllCommits;
/** @type {import('../src/git.js').findActiveYears} */
let findActiveYears;

before(async () => {
  const mod = await import('../src/git.js');
  getAllCommits = mod.getAllCommits;
  findActiveYears = mod.findActiveYears;
});

before(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'insights-test-'));

  // Repo with 2 commits
  repoWithCommits = join(tmpDir, 'has-commits');
  execSync(`git init "${repoWithCommits}"`, { stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: repoWithCommits, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: repoWithCommits, stdio: 'pipe' });
  writeFileSync(join(repoWithCommits, 'a.txt'), 'a\n');
  execSync('git add a.txt && git commit -m "first"', { cwd: repoWithCommits, stdio: 'pipe' });
  writeFileSync(join(repoWithCommits, 'b.txt'), 'b\n');
  execSync('git add b.txt && git commit -m "second"', { cwd: repoWithCommits, stdio: 'pipe' });

  // Empty repo
  emptyRepo = join(tmpDir, 'empty');
  execSync(`git init "${emptyRepo}"`, { stdio: 'pipe' });
});

after(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests for getAllCommits with maxWaitMs option
// ---------------------------------------------------------------------------
describe('getAllCommits() — maxWaitMs timeout', () => {
  it('should clear the timeout when output arrives before the deadline', async () => {
    let timeoutFired = false;

    const commits = [];
    for await (const commit of getAllCommits(repoWithCommits, {
      maxWaitMs: 5000,
      onError: () => {
        timeoutFired = true;
      }
    })) {
      commits.push(commit);
    }

    assert.strictEqual(timeoutFired, false, 'timeout should NOT fire when output arrives quickly');
    assert.strictEqual(commits.length, 2);
  });

  it(
    'should call onError with a timeout error when no stdout output arrives within maxWaitMs',
    { timeout: 2000 },
    async () => {
      // Empty repo: git log --all produces zero stdout lines (no delimiter line,
      // no nothing). firstLineReceived stays false, so the timeout fires.
      const errors = [];

      for await (const commit of getAllCommits(emptyRepo, {
        maxWaitMs: 10,
        onError: (err) => {
          errors.push(err);
        }
      })) {
        // nocommits — empty repo yields nothing
      }

      // The timeout is set to fire after 10ms. Give it a chance.
      await new Promise((r) => setTimeout(r, 50));

      assert.strictEqual(errors.length, 1, 'onError should be called exactly once');
      assert.ok(errors[0] instanceof Error);
      assert.ok(
        errors[0].message.includes('No output from git within timeout'),
        `got: ${errors[0].message}`
      );
    }
  );

  it(
    'should not crash when maxWaitMs is set but onError is omitted',
    { timeout: 2000 },
    async () => {
      // Timeout fires, there is no onError — it's a silent no-op.
      const commits = [];
      for await (const commit of getAllCommits(emptyRepo, {
        maxWaitMs: 10
      })) {
        commits.push(commit);
      }
      assert.strictEqual(commits.length, 0);
    }
  );

  it('should call onError only once (guard flag works)', { timeout: 2000 }, async () => {
    const errors = [];

    for await (const commit of getAllCommits(emptyRepo, {
      maxWaitMs: 5,
      onError: (err) => {
        errors.push(err);
      }
    })) {
      // noop
    }

    await new Promise((r) => setTimeout(r, 30));

    assert.strictEqual(errors.length, 1, 'onError must be called at most once');
  });

  it('should not trigger timeout when output arrives well before the deadline', async () => {
    // maxWaitMs of 2000ms is generous — git log completes in a few ms,
    // so the timeout should never fire.
    let timeoutFired = false;

    const commits = [];
    for await (const commit of getAllCommits(repoWithCommits, {
      maxWaitMs: 2000,
      onError: () => {
        timeoutFired = true;
      }
    })) {
      commits.push(commit);
    }

    assert.strictEqual(
      timeoutFired,
      false,
      'timeout should not fire when output arrives well before maxWaitMs'
    );
    assert.strictEqual(commits.length, 2);
  });
});

// ---------------------------------------------------------------------------
// Tests for getAllCommits with onError option — error from process 'error'
// event (low-level spawn failure).
// ---------------------------------------------------------------------------
describe('getAllCommits() — onError from process error event', () => {
  it('should work without onError (backward compat)', async () => {
    const commits = [];
    for await (const commit of getAllCommits(repoWithCommits)) {
      commits.push(commit);
    }
    assert.strictEqual(commits.length, 2);
  });

  it('should work without any options (backward compat)', async () => {
    const commits = [];
    for await (const commit of getAllCommits(repoWithCommits)) {
      commits.push(commit);
    }
    assert.strictEqual(commits.length, 2);
  });

  it('onError must not be called when git succeeds', async () => {
    const errors = [];

    const commits = [];
    for await (const commit of getAllCommits(repoWithCommits, {
      onError: (err) => {
        errors.push(err);
      }
    })) {
      commits.push(commit);
    }

    assert.strictEqual(commits.length, 2);
    assert.strictEqual(errors.length, 0, 'onError must NOT be called on success');
  });

  it('should accept unknown options without error', async () => {
    const commits = [];
    for await (const commit of getAllCommits(repoWithCommits, {
      // @ts-expect-error — unknown options are silently ignored
      unknownOption: true
    })) {
      commits.push(commit);
    }
    assert.strictEqual(commits.length, 2);
  });
});

// ---------------------------------------------------------------------------
// Tests for findActiveYears — edge cases not in git.test.js
// ---------------------------------------------------------------------------
describe('findActiveYears() — edge cases', () => {
  it('should return empty set when range covers no commit years (past)', async () => {
    const active = await findActiveYears(repoWithCommits, 1990, 1999);
    assert.ok(active instanceof Set);
    assert.strictEqual(active.size, 0);
  });

  it('should return empty set when range is entirely in the future', async () => {
    const active = await findActiveYears(repoWithCommits, 2099, 2100);
    assert.strictEqual(active.size, 0);
  });

  it('should honour the firstYear/lastYear range: exclude commits outside it', async () => {
    // Create a repo with commits in 2021, 2022 and 2023.
    const path = join(tmpDir, 'year-range-test');
    execSync(`git init "${path}"`, { stdio: 'pipe' });
    execSync('git config user.name "T"', { cwd: path, stdio: 'pipe' });
    execSync('git config user.email "t@t.com"', { cwd: path, stdio: 'pipe' });
    writeFileSync(join(path, 'f1.txt'), 'a\n');
    execSync(
      'git add f1.txt && GIT_AUTHOR_DATE="2021-01-01T12:00:00" GIT_COMMITTER_DATE="2021-01-01T12:00:00" git commit -m "2021"',
      { cwd: path, stdio: 'pipe' }
    );
    writeFileSync(join(path, 'f2.txt'), 'b\n');
    execSync(
      'git add f2.txt && GIT_AUTHOR_DATE="2022-06-15T12:00:00" GIT_COMMITTER_DATE="2022-06-15T12:00:00" git commit -m "2022"',
      { cwd: path, stdio: 'pipe' }
    );
    writeFileSync(join(path, 'f3.txt'), 'c\n');
    execSync(
      'git add f3.txt && GIT_AUTHOR_DATE="2023-12-31T12:00:00" GIT_COMMITTER_DATE="2023-12-31T12:00:00" git commit -m "2023"',
      { cwd: path, stdio: 'pipe' }
    );

    const limited = await findActiveYears(path, 2022, 2022);
    assert.strictEqual(limited.size, 1);
    assert.ok(limited.has(2022));

    rmSync(path, { recursive: true, force: true });
  });

  it('should handle pathological range where firstYear > lastYear', async () => {
    // The function doesn't validate the range, but it should not crash.
    const active = await findActiveYears(emptyRepo, 2025, 2020);
    assert.ok(active instanceof Set);
    assert.strictEqual(active.size, 0);
  });

  it('should reject for a non-existent path', async () => {
    await assert.rejects(() => findActiveYears('/nonexistent/path/for/testing', 2020, 2025), {
      name: 'Error'
    });
  });
});

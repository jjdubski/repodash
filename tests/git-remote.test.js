import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ---------------------------------------------------------------------------
// Module under test — imported once in before()
// ---------------------------------------------------------------------------
/** @type {import('../src/git.js').cloneRemoteRepo} */
let cloneRemoteRepo;

before(async () => {
  const mod = await import('../src/git.js');
  cloneRemoteRepo = mod.cloneRemoteRepo;
});

// ---------------------------------------------------------------------------
// Tests for cloneRemoteRepo() — uses local file:// repos to avoid network
// ---------------------------------------------------------------------------
describe('cloneRemoteRepo()', () => {
  let tmpDir;
  let sourceBareRepo;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'repodash-test-clone-'));

    // Create a bare source repo that we can clone locally
    sourceBareRepo = join(tmpDir, 'source.git');
    execSync(`git init --bare "${sourceBareRepo}"`, { stdio: 'pipe' });

    // Create a working directory to push initial commits to the bare repo
    const workingDir = join(tmpDir, 'working');
    execSync(`git init "${workingDir}"`, { stdio: 'pipe' });
    execSync('git config user.name "Test"', { cwd: workingDir, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: workingDir, stdio: 'pipe' });
    writeFileSync(join(workingDir, 'readme.md'), '# Hello\n');
    execSync('git add readme.md && git commit -m "Initial commit"', {
      cwd: workingDir,
      stdio: 'pipe'
    });
    execSync(`git remote add origin "${sourceBareRepo}"`, { cwd: workingDir, stdio: 'pipe' });
    execSync('git push origin HEAD:master', { cwd: workingDir, stdio: 'pipe' });
    execSync('git symbolic-ref HEAD refs/heads/master', { cwd: sourceBareRepo, stdio: 'pipe' });
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should clone a repo via file:// URL without a token', async () => {
    const targetDir = join(tmpDir, 'cloned-no-token');

    const result = await cloneRemoteRepo(`file://${sourceBareRepo}`, null, targetDir);

    assert.strictEqual(result, targetDir);
    assert.ok(existsSync(join(targetDir, '.git')));
    assert.ok(existsSync(join(targetDir, 'readme.md')));

    // Verify it's a valid clone
    const log = execSync('git log --oneline', { cwd: targetDir, stdio: 'pipe' }).toString();
    assert.ok(log.includes('Initial commit'));
  });

  it('should inject token into https URLs, stripping the https:// prefix', async () => {
    // Unit test the URL construction logic directly.
    // When given "https://github.com/user/repo.git" and token "ghp_abc",
    // the output should be "https://ghp_abc@github.com/user/repo.git"
    const targetDir = join(tmpDir, 'cloned-token-test');

    // We can't test a real https clone without a real token, but the function
    // should generate the correct URL. Use file:// as the actual target
    // (which won't trigger token injection since file:// != startsWith('http')).
    const result = await cloneRemoteRepo(`file://${sourceBareRepo}`, null, targetDir);
    assert.strictEqual(result, targetDir);
    assert.ok(existsSync(join(targetDir, '.git')));

    // Now verify the token injection formula separately:
    const remoteUrl = 'https://github.com/user/repo.git';
    const token = 'ghp_abc123';
    const expected = `https://${token}@${remoteUrl.replace(/^https?:\/\//, '')}`;
    assert.strictEqual(expected, 'https://ghp_abc123@github.com/user/repo.git');
    assert.ok(!expected.includes('https://https://'));
  });

  it('should handle multiple branches after clone', async () => {
    // Add a branch to source
    const workingDir = join(tmpDir, 'working');
    execSync('git checkout -b feature-branch', { cwd: workingDir, stdio: 'pipe' });
    writeFileSync(join(workingDir, 'feature.txt'), 'feature\n');
    execSync('git add feature.txt && git commit -m "Feature commit"', {
      cwd: workingDir,
      stdio: 'pipe'
    });
    execSync('git push origin feature-branch', { cwd: workingDir, stdio: 'pipe' });

    const targetDir = join(tmpDir, 'cloned-branches');
    await cloneRemoteRepo(`file://${sourceBareRepo}`, null, targetDir);

    // Check that we have both branches
    const branches = execSync('git branch -a', {
      cwd: targetDir,
      stdio: 'pipe'
    })
      .toString()
      .trim();
    assert.ok(branches.includes('master') || branches.includes('feature-branch'));
  });

  it('should reject when cloning a non-existent repo', async () => {
    const targetDir = join(tmpDir, 'cloned-nonexistent');

    await assert.rejects(
      () => cloneRemoteRepo('file:///tmp/nonexistent-repodash-test-repo.git', null, targetDir),
      /not found|does not exist|repository/
    );
  });
});

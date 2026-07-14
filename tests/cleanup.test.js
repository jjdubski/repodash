import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

describe('cleanup on SIGINT', () => {
  let fixtureDir;
  let repoPath;
  let privateTmpDir;

  before(() => {
    fixtureDir = mkdtempSync(join(tmpdir(), 'repodash-test-cleanup-'));
    privateTmpDir = mkdtempSync(join(fixtureDir, 'tmp-'));
    repoPath = join(fixtureDir, 'test-repo');
    execSync(`git init "${repoPath}"`, { stdio: 'pipe' });
    execSync('git config user.name "Test"', { cwd: repoPath, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: repoPath, stdio: 'pipe' });
    writeFileSync(join(repoPath, 'f.txt'), 'hello\n');
    execSync('git add f.txt && git commit -m "Initial"', { cwd: repoPath, stdio: 'pipe' });
  });

  after(() => {
    rmSync(fixtureDir, { recursive: true, force: true });
  });

  it('should delete the temp directory on SIGINT', async () => {
    const beforeSnapshot = new Set(
      readdirSync(privateTmpDir).filter((d) => /^repodash-[a-z0-9]{6}$/i.test(d))
    );

    const cliPath = join(__dirname, '..', 'bin', 'repodash.js');
    const child = spawn(process.execPath, [cliPath, repoPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, TMPDIR: privateTmpDir, REPODASH_DISABLE_OPEN: '1' }
    });

    let stdout = '';
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Timed out waiting for dashboard URL')),
        15000
      );
      child.stdout.on('data', (data) => {
        stdout += data.toString();
        if (stdout.includes('localhost:')) {
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    child.kill('SIGINT');

    const exitCode = await new Promise((resolve) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolve(-1);
      }, 8000);
      child.on('exit', (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });

    assert.strictEqual(exitCode, 0, `expected exit code 0, got ${exitCode}`);

    await new Promise((r) => setTimeout(r, 500));

    const afterSnapshot = readdirSync(privateTmpDir).filter((d) =>
      /^repodash-[a-z0-9]{6}$/i.test(d)
    );
    const stale = afterSnapshot.filter((d) => !beforeSnapshot.has(d));
    assert.strictEqual(stale.length, 0, `temp directory was not deleted: ${stale.join(', ')}`);
  });
});

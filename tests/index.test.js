import { describe, it, before } from 'node:test';
import assert from 'node:assert';

/** @type {import('../src/index.js').main} */
let main;

describe('main orchestrator (src/index.js)', () => {
  before(async () => {
    const mod = await import('../src/index.js');
    main = mod.main;
  });

  it('should export main as a function', () => {
    assert.strictEqual(typeof main, 'function');
  });

  it('should reject with a descriptive error for a non-existent repo path', async () => {
    await assert.rejects(
      () => main('/tmp/nonexistent-repo-path-for-testing'),
      /Not a git repository/,
      'main() should reject when the repo path does not exist',
    );
  });

  it('should reject with a descriptive error when called with no arguments', async () => {
    await assert.rejects(
      () => main(),
      /Not a git repository/,
      'main() should reject when called with undefined repoPath',
    );
  });
});

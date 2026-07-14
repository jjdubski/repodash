import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('module imports', () => {
  it('should import src/index.js without error', async () => {
    // Arrange & Act
    const mod = await import('../src/index.js');

    // Assert
    assert.ok(mod);
    assert.ok(mod.main);
  });

  it('should import src/git.js without error', async () => {
    // Arrange & Act
    const mod = await import('../src/git.js');

    // Assert
    assert.ok(mod);
  });

  it('should import src/aggregate.js without error', async () => {
    // Arrange & Act
    const mod = await import('../src/aggregate.js');

    // Assert
    assert.ok(mod);
  });

  it('should import src/server.js without error', async () => {
    // Arrange & Act
    const mod = await import('../src/server.js');

    // Assert
    assert.ok(mod);
  });

  it('should import bin/repodash.js as an ES module without syntax errors', async () => {
    // Arrange — the CLI module reads process.argv and calls process.exit
    // if no path is given. We provide a dummy path and stub process.exit
    // so the import succeeds without killing the test runner.
    const originalExit = process.exit;
    const originalArgv = process.argv;

    process.argv = ['node', 'repodash.js', '/tmp/test-repo'];
    process.exit = /** @type {any} */ (() => {});

    try {
      // Act
      const mod = await import('../bin/repodash.js');

      // Assert
      assert.ok(mod);
    } catch (err) {
      assert.fail(`bin/repodash.js failed to import as ES module: ${err.message}`);
    } finally {
      // Cleanup
      process.exit = originalExit;
      process.argv = originalArgv;
    }
  });
});

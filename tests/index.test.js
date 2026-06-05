import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('main orchestrator (src/index.js)', () => {
  it('should export main as a function', async () => {
    // Arrange & Act
    const { main } = await import('../src/index.js');

    // Assert
    assert.strictEqual(typeof main, 'function');
  });

  it('should run without throwing when given a repo path', async () => {
    // Arrange
    const { main } = await import('../src/index.js');

    // Act & Assert — node:test catches rejected promises
    await main('/tmp/some-repo');
  });

  it('should not crash when called with no arguments (scaffold behavior)', async () => {
    // Arrange
    const { main } = await import('../src/index.js');

    // Act & Assert
    try {
      await main();
    } catch (err) {
      assert.fail(`main() with no arguments threw: ${err.message}`);
    }
  });
});

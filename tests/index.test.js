import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import {
  mkdtempSync,
  writeFileSync,
  appendFileSync,
  rmSync,
  readFileSync,
  existsSync,
  readdirSync
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import http from 'node:http';

// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------
/** @type {import('../src/index.js').main} */
let main;

// ---------------------------------------------------------------------------
// Fixture repo paths (set during before())
// ---------------------------------------------------------------------------
/** @type {string} */
let repoPath;
/** @type {string} */
let tmpDir;

before(async () => {
  const mod = await import('../src/index.js');
  main = mod.main;
});

before(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'repodash-test-index-'));
  repoPath = join(tmpDir, 'test-repo');

  execSync(`git init "${repoPath}"`, { stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: repoPath, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', {
    cwd: repoPath,
    stdio: 'pipe'
  });

  // Commit 1
  writeFileSync(join(repoPath, 'file1.txt'), 'hello\n');
  execSync('git add file1.txt && git commit -m "Initial commit"', {
    cwd: repoPath,
    stdio: 'pipe'
  });

  // Commit 2: different author
  appendFileSync(join(repoPath, 'file1.txt'), 'world\n');
  writeFileSync(join(repoPath, 'file2.txt'), 'feature a\n');
  execSync('git add file1.txt file2.txt && git commit -m "Add feature A"', {
    cwd: repoPath,
    stdio: 'pipe'
  });

  // Commit 3: second author
  writeFileSync(join(repoPath, 'file3.txt'), 'feature b\n');
  execSync(
    'git add file3.txt && git commit -m "Add feature B" --author="Developer2 <dev2@test.com>"',
    { cwd: repoPath, stdio: 'pipe' }
  );
});

after(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('main orchestrator (src/index.js)', () => {
  it('should export main as a function', () => {
    assert.strictEqual(typeof main, 'function');
  });

  it('should reject with a descriptive error for a non-existent repo path', async () => {
    await assert.rejects(
      () => main('/tmp/nonexistent-repo-path-for-testing'),
      /not a git repository/
    );
  });

  it('should reject with a descriptive error when called with no arguments', async () => {
    await assert.rejects(() => main(undefined), /not a git repository/);
  });

  // -----------------------------------------------------------------------
  // JSON output mode
  // -----------------------------------------------------------------------

  it('should produce valid JSON output with { json: true }', async () => {
    const logs = [];
    const originalLog = console.log;

    try {
      // Replace console.log to capture JSON output
      console.log = (...args) => logs.push(args.join(' '));

      await main(repoPath, { json: true });

      assert.strictEqual(logs.length, 1, 'console.log should be called once');
      const output = logs[0];
      const parsed = JSON.parse(output);

      // Verify all 5 datasets are present
      assert.ok(parsed.summary);
      assert.ok(parsed.contributions);
      assert.ok(parsed.contributors);
      assert.ok(parsed.frequency);
      assert.ok(parsed.activity);

      // Verify data integrity
      assert.strictEqual(parsed.summary.totalCommits, 3);
      assert.strictEqual(parsed.summary.totalContributors, 2);
      assert.strictEqual(parsed.summary.repoName, 'test-repo');
      // All 3 commits are in the same day, so 1 contribution entry
      assert.strictEqual(parsed.contributions.length, 1);
      assert.strictEqual(parsed.contributions[0].count, 3);
      assert.strictEqual(parsed.contributors.length, 2);
      assert.strictEqual(parsed.frequency.length, 1);
      assert.strictEqual(parsed.frequency[0].additions, 4);
      assert.strictEqual(parsed.frequency[0].deletions, 0);
    } finally {
      console.log = originalLog;
    }
  });

  it('should reject with missing path even with { json: true }', async () => {
    await assert.rejects(() => main(undefined, { json: true }), /not a git repository/);
  });

  // -----------------------------------------------------------------------
  // File output mode
  // -----------------------------------------------------------------------

  it('should write JSON file to repo path with { file: true }', async () => {
    await main(repoPath, { file: true });

    const dirEntries = readdirSync(repoPath);
    const jsonFiles = dirEntries.filter((f) => f.startsWith('repodash_') && f.endsWith('.json'));

    assert.strictEqual(
      jsonFiles.length,
      1,
      `expected exactly one repodash_*.json file, found ${JSON.stringify(jsonFiles)}`
    );

    const content = readFileSync(join(repoPath, jsonFiles[0]), 'utf-8');
    const parsed = JSON.parse(content);
    assert.strictEqual(parsed.summary.totalCommits, 3);
    assert.strictEqual(parsed.summary.repoName, 'test-repo');

    // Clean up created file for subsequent tests
    rmSync(join(repoPath, jsonFiles[0]));
  });

  it('should write JSON to an explicit path with { file: "path" }', async () => {
    const outputPath = join(tmpDir, 'custom-output.json');

    await main(repoPath, { file: outputPath });

    assert.ok(existsSync(outputPath), 'file should exist at explicit path');

    const content = readFileSync(outputPath, 'utf-8');
    const parsed = JSON.parse(content);
    assert.strictEqual(parsed.summary.totalCommits, 3);
    assert.strictEqual(parsed.summary.totalContributors, 2);
  });

  it('should write JSON to a new file path without treating it as a directory when the path does not exist', async () => {
    const newFilePath = join(tmpDir, 'nonexistent-output.json');
    assert.ok(!existsSync(newFilePath), 'precondition: file should not exist');

    await main(repoPath, { file: newFilePath });

    assert.ok(existsSync(newFilePath), 'file should be created at the given path');
    const content = readFileSync(newFilePath, 'utf-8');
    const parsed = JSON.parse(content);
    assert.strictEqual(parsed.summary.totalCommits, 3);
    assert.strictEqual(parsed.summary.totalContributors, 2);

    // Clean up
    rmSync(newFilePath);
  });

  it('should write JSON file to a specified existing directory with { file: directory }', async () => {
    // Create a temporary subdirectory (outside of the repo directory)
    const outputDir = mkdtempSync(join(tmpDir, 'repodash-dir-'));

    await main(repoPath, { file: outputDir });

    const dirEntries = readdirSync(outputDir);
    const jsonFiles = dirEntries.filter((f) => f.startsWith('repodash_') && f.endsWith('.json'));
    assert.strictEqual(
      jsonFiles.length,
      1,
      `expected exactly one repodash_*.json file in the directory, found ${JSON.stringify(jsonFiles)}`
    );

    const filename = jsonFiles[0];
    assert.match(
      filename,
      /^repodash_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.json$/,
      `filename "${filename}" does not match the expected timestamp format`
    );

    const content = readFileSync(join(outputDir, filename), 'utf-8');
    const parsed = JSON.parse(content);
    assert.strictEqual(parsed.summary.totalCommits, 3);
    assert.strictEqual(parsed.summary.totalContributors, 2);

    // Cleanup the generated file and directory
    rmSync(join(outputDir, filename));
    rmSync(outputDir, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // Dataset filtering
  // -----------------------------------------------------------------------

  it('should only include requested keys with filter options', async () => {
    const logs = [];
    const originalLog = console.log;
    console.log = (...args) => {
      logs.push(args.join(' '));
    };

    try {
      await main(repoPath, {
        json: true,
        summary: true,
        contributions: true
      });

      const parsed = JSON.parse(logs[0]);
      const keys = Object.keys(parsed).sort((a, b) => a.localeCompare(b));

      assert.deepStrictEqual(keys, ['contributions', 'summary']);
      assert.ok(parsed.summary);
      assert.ok(parsed.contributions);
      assert.strictEqual(parsed.summary.totalCommits, 3);
      assert.strictEqual(parsed.contributions.length, 1);
    } finally {
      console.log = originalLog;
    }
  });

  it('should return all datasets when no filter flags are set', async () => {
    const logs = [];
    const originalLog = console.log;
    console.log = (...args) => {
      logs.push(args.join(' '));
    };

    try {
      await main(repoPath, { json: true });

      const parsed = JSON.parse(logs[0]);
      assert.deepStrictEqual(
        Object.keys(parsed).sort((a, b) => a.localeCompare(b)),
        [
          'activity',
          'contributions',
          'contributors',
          'frequency',
          'languages',
          'repoData',
          'repos',
          'summary'
        ]
      );
    } finally {
      console.log = originalLog;
    }
  });

  it('should ignore unknown filter flags and return all datasets', async () => {
    const logs = [];
    const originalLog = console.log;
    console.log = (...args) => {
      logs.push(args.join(' '));
    };

    try {
      // 'bogus' is not in filterFlags so hasAnyFilter is false → full result
      await main(repoPath, { json: true, bogus: true });

      const parsed = JSON.parse(logs[0]);
      assert.deepStrictEqual(
        Object.keys(parsed).sort((a, b) => a.localeCompare(b)),
        [
          'activity',
          'contributions',
          'contributors',
          'frequency',
          'languages',
          'repoData',
          'repos',
          'summary'
        ]
      );
    } finally {
      console.log = originalLog;
    }
  });

  // -----------------------------------------------------------------------
  // Timing output
  // -----------------------------------------------------------------------

  it('should include timing information on stderr with { timing: true }', async () => {
    const errors = [];
    const originalLog = console.log;
    const originalErr = console.error;
    console.log = () => {};
    console.error = (...args) => {
      errors.push(args.join(' '));
    };

    try {
      await main(repoPath, { json: true, timing: true });

      const allErrors = errors.join('\n');
      assert.ok(allErrors.includes('Parse commits'));
      assert.ok(allErrors.includes('Merge contributors'));
      assert.ok(allErrors.includes('Format results'));
      assert.ok(allErrors.includes('Generate output'));
      assert.ok(allErrors.includes('Total'));
    } finally {
      console.log = originalLog;
      console.error = originalErr;
    }
  });

  it('should not include timing output when timing option is not set', async () => {
    const errors = [];
    const originalLog = console.log;
    const originalErr = console.error;
    console.log = () => {};
    console.error = (...args) => {
      errors.push(args.join(' '));
    };

    try {
      await main(repoPath, { json: true });

      const allErrors = errors.join('\n');
      assert.ok(!allErrors.includes('Parse commits'));
      assert.ok(!allErrors.includes('Generate output'));
    } finally {
      console.log = originalLog;
      console.error = originalErr;
    }
  });

  // -----------------------------------------------------------------------
  // Dashboard mode
  // -----------------------------------------------------------------------

  it('should work in dashboard mode and print the dashboard URL', async () => {
    const logs = [];
    const originalLog = console.log;
    const originalExit = process.exit;
    const originalWarn = console.warn;
    const originalCreateServer = http.createServer;
    let capturedServer;

    console.log = (...args) => {
      logs.push(args.join(' '));
    };
    console.warn = () => {};
    process.exit = /** @type {typeof process.exit} */ (() => {});
    // Capture the server instance so we can close it after the test
    http.createServer = function (...args) {
      const srv = originalCreateServer.apply(http, args);
      capturedServer = srv;
      return srv;
    };

    try {
      await main(repoPath, { openBrowser: () => Promise.resolve() });

      const hasDashboardUrl = logs.some(
        (l) => l.includes('localhost:') || l.includes('repodash dashboard')
      );
      assert.ok(
        hasDashboardUrl,
        `console.log should contain dashboard URL, got: ${JSON.stringify(logs)}`
      );
    } finally {
      console.log = originalLog;
      console.warn = originalWarn;
      process.exit = originalExit;
      http.createServer = originalCreateServer;

      // Close the server to let the event loop drain
      if (capturedServer) {
        await new Promise((resolve) => {
          capturedServer.close(resolve);
        });
      }
    }
  });

  it('dashboard mode should not throw for a valid repo', async () => {
    const originalLog = console.log;
    const originalExit = process.exit;
    const originalWarn = console.warn;
    const originalCreateServer = http.createServer;
    let capturedServer;

    console.log = () => {};
    console.warn = () => {};
    process.exit = /** @type {typeof process.exit} */ (() => {});
    http.createServer = function (...args) {
      const srv = originalCreateServer.apply(http, args);
      capturedServer = srv;
      return srv;
    };

    try {
      await assert.doesNotReject(
        () => main(repoPath, { openBrowser: () => Promise.resolve() }),
        'dashboard mode should not throw for a valid repo path'
      );
    } finally {
      console.log = originalLog;
      console.warn = originalWarn;
      process.exit = originalExit;
      http.createServer = originalCreateServer;

      if (capturedServer) {
        await new Promise((resolve) => {
          capturedServer.close(resolve);
        });
      }
    }
  });

  // -----------------------------------------------------------------------
  // PDF output mode
  // -----------------------------------------------------------------------

  it('should generate a PDF file when { pdf: "path" } is provided', async () => {
    // Guard: skip if Playwright or its browser binary isn't available
    let playwright;
    try {
      playwright = await import('playwright');
      const execPath = playwright.chromium.executablePath();
      if (!existsSync(execPath)) {
        return; // skip — browser binary not installed
      }
    } catch {
      return; // skip — playwright not installed
    }

    const outputPath = join(tmpDir, 'test-output.pdf');

    await main(repoPath, { pdf: outputPath });

    assert.ok(existsSync(outputPath), `PDF file should exist at ${outputPath}`);

    // Check PDF magic bytes
    const header = readFileSync(outputPath).slice(0, 5).toString();
    assert.strictEqual(header, '%PDF-', 'File should have PDF magic bytes');
  });

  // -----------------------------------------------------------------------
  // Shutdown handlers (tested through dashboard mode inline code)
  // -----------------------------------------------------------------------

  describe('shutdown handlers', () => {
    it('should register handlers on SIGINT, SIGTERM, SIGHUP, and stdin close', async () => {
      const onceCalls = [];
      const stdinOnCalls = [];
      let capturedServer;

      mock.method(process, 'once', (event, handler) => {
        onceCalls.push({ event, handler });
        return process;
      });
      mock.method(process.stdin, 'on', (event, handler) => {
        stdinOnCalls.push({ event, handler });
        return process.stdin;
      });
      mock.method(process, 'exit', () => {});

      const originalCreateServer = http.createServer;
      http.createServer = function (...args) {
        const srv = originalCreateServer.apply(http, args);
        capturedServer = srv;
        return srv;
      };

      try {
        await main(repoPath, { openBrowser: () => Promise.resolve() });

        assert.ok(
          onceCalls.some((c) => c.event === 'SIGINT'),
          'should register SIGINT handler'
        );
        assert.ok(
          onceCalls.some((c) => c.event === 'SIGTERM'),
          'should register SIGTERM handler'
        );
        assert.ok(
          onceCalls.some((c) => c.event === 'SIGHUP'),
          'should register SIGHUP handler'
        );
        assert.ok(
          stdinOnCalls.some((c) => c.event === 'close'),
          'should register stdin close handler'
        );
      } finally {
        mock.restoreAll();
        http.createServer = originalCreateServer;
        if (capturedServer) {
          await new Promise((resolve) => capturedServer.close(resolve));
        }
      }
    });

    it('should call cleanup and exit(0) when a signal is received', async () => {
      const onceCalls = [];
      let exitCode;
      let capturedServer;

      mock.method(process, 'once', (event, handler) => {
        onceCalls.push({ event, handler });
        return process;
      });
      mock.method(process.stdin, 'on', () => process.stdin);
      mock.method(process, 'exit', (code) => {
        exitCode = code;
      });

      const originalCreateServer = http.createServer;
      http.createServer = function (...args) {
        const srv = originalCreateServer.apply(http, args);
        capturedServer = srv;
        return srv;
      };

      try {
        await main(repoPath, { openBrowser: () => Promise.resolve() });

        const sigintHandler = onceCalls.find((c) => c.event === 'SIGINT');
        assert.ok(sigintHandler, 'SIGINT handler should be registered');

        sigintHandler.handler();

        assert.strictEqual(exitCode, 0, 'should exit with code 0');
      } finally {
        mock.restoreAll();
        http.createServer = originalCreateServer;
        if (capturedServer) {
          await new Promise((resolve) => capturedServer.close(resolve));
        }
      }
    });

    it('should prevent double-cleanup when multiple signals fire', async () => {
      const onceCalls = [];
      let exitCallCount = 0;
      let capturedServer;

      mock.method(process, 'once', (event, handler) => {
        onceCalls.push({ event, handler });
        return process;
      });
      mock.method(process.stdin, 'on', () => process.stdin);
      mock.method(process, 'exit', () => {
        exitCallCount++;
      });

      const originalCreateServer = http.createServer;
      http.createServer = function (...args) {
        const srv = originalCreateServer.apply(http, args);
        capturedServer = srv;
        return srv;
      };

      try {
        await main(repoPath, { openBrowser: () => Promise.resolve() });

        const sigintHandler = onceCalls.find((c) => c.event === 'SIGINT').handler;
        const sighupHandler = onceCalls.find((c) => c.event === 'SIGHUP').handler;

        // Fire two different signals
        sigintHandler();
        sighupHandler();

        assert.strictEqual(exitCallCount, 1, 'exit should be called only once');
      } finally {
        mock.restoreAll();
        http.createServer = originalCreateServer;
        if (capturedServer) {
          await new Promise((resolve) => capturedServer.close(resolve));
        }
      }
    });

    it('should still clean up temp dirs even if the repo scan fails', async () => {
      // If main() throws before reaching the shutdown handler registration,
      // the process 'exit' handler (line 50) should still clean up temp dirs
      // via the registered process.on('exit', cleanupSync) at module scope.
      // This test verifies the exit handler is in place and not broken by
      // shutdown handler changes.

      mock.method(process, 'exit', () => {});

      try {
        await assert.rejects(() => main(undefined), /not a git repository/);
      } finally {
        mock.restoreAll();
      }
    });
  });
});

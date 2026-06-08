import { describe, it, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';

/** @type {import('../src/cli.js').parseAndValidate} */
let parseAndValidate;

class ExitError extends Error {
  constructor(code) {
    super(`process.exit(${code})`);
    this.code = code;
  }
}

before(async () => {
  const mod = await import('../src/cli.js');
  parseAndValidate = mod.parseAndValidate;
});

describe('parseAndValidate', () => {
  /** @type {typeof process.exit} */
  let origExit;

  beforeEach(() => {
    origExit = process.exit;
    process.exit = /** @type {any} */ (
      (code) => {
        throw new ExitError(code ?? 0);
      }
    );
  });

  afterEach(() => {
    process.exit = origExit;
  });

  it('should return repoPath and values for basic flags', () => {
    const result = parseAndValidate(['--json', '/path/to/repo']);
    assert.strictEqual(result.repoPath, '/path/to/repo');
    assert.strictEqual(result.values.json, true);
  });

  it('should exit with code 0 for --help', () => {
    assert.throws(
      () => parseAndValidate(['--help', '/path/to/repo']),
      (err) => err instanceof ExitError && err.code === 0,
    );
  });

  it('should exit with code 0 for -h', () => {
    assert.throws(
      () => parseAndValidate(['-h', '/path/to/repo']),
      (err) => err instanceof ExitError && err.code === 0,
    );
  });

  it('should exit with code 1 when no repo path is provided', () => {
    assert.throws(
      () => parseAndValidate(['--json']),
      (err) => err instanceof ExitError && err.code === 1,
    );
  });

  it('should exit with code 1 when --json and --file are both set', () => {
    assert.throws(
      () => parseAndValidate(['--json', '--file', '/path/to/repo']),
      (err) => err instanceof ExitError && err.code === 1,
    );
  });

  it('should set values.file to path string when --file has an explicit value and a positional repo path exists', () => {
    const result = parseAndValidate(['--file', 'output.json', '/path/to/repo']);
    assert.strictEqual(result.repoPath, '/path/to/repo');
    assert.strictEqual(result.values.file, 'output.json');
  });

  it('should set values.file to true when --file is used as a boolean flag (no value)', () => {
    const result = parseAndValidate(['--file', '--summary', '/path/to/repo']);
    assert.strictEqual(result.repoPath, '/path/to/repo');
    assert.strictEqual(result.values.file, true);
  });

  it('should reinterpret --file path as repoPath when no positional is given', () => {
    const result = parseAndValidate(['--file', '/some/repo/path']);
    assert.strictEqual(result.repoPath, '/some/repo/path');
    assert.strictEqual(result.values.file, true);
  });

  it('should parse all filter flags correctly', () => {
    const result = parseAndValidate([
      '--summary',
      '--contributions',
      '--contributors',
      '--frequency',
      '--activity',
      '/path/to/repo',
    ]);
    assert.strictEqual(result.repoPath, '/path/to/repo');
    assert.strictEqual(result.values.summary, true);
    assert.strictEqual(result.values.contributions, true);
    assert.strictEqual(result.values.contributors, true);
    assert.strictEqual(result.values.frequency, true);
    assert.strictEqual(result.values.activity, true);
  });

  it('should parse --timing flag', () => {
    const result = parseAndValidate(['--timing', '/path/to/repo']);
    assert.strictEqual(result.repoPath, '/path/to/repo');
    assert.strictEqual(result.values.timing, true);
  });

  it('should parse multiple combined flags', () => {
    const result = parseAndValidate([
      '--json',
      '--timing',
      '--summary',
      '--contributions',
      '/path/to/repo',
    ]);
    assert.strictEqual(result.repoPath, '/path/to/repo');
    assert.strictEqual(result.values.json, true);
    assert.strictEqual(result.values.timing, true);
    assert.strictEqual(result.values.summary, true);
    assert.strictEqual(result.values.contributions, true);
  });

  it('should return empty values object when only a repo path is provided', () => {
    const result = parseAndValidate(['/path/to/repo']);
    assert.strictEqual(result.repoPath, '/path/to/repo');
    assert.strictEqual(Object.keys(result.values).length, 0);
  });

  it('should exit with code 1 when called with empty argv', () => {
    assert.throws(
      () => parseAndValidate([]),
      (err) => err instanceof ExitError && err.code === 1,
    );
  });

  it('should exit with code 1 when --file has an empty value and no positional', () => {
    assert.throws(
      () => parseAndValidate(['--file', '']),
      (err) => err instanceof ExitError && err.code === 1,
    );
  });

  it('should exit with code 1 when duplicate --file flags are provided', () => {
    assert.throws(
      () => parseAndValidate(['--file', 'path1', '--file', 'path2', '/repo']),
      (err) => err instanceof ExitError && err.code === 1,
    );
  });

  it('should exit with code 1 when multiple positionals are provided', () => {
    assert.throws(
      () => parseAndValidate(['/repo1', '/repo2']),
      (err) => err instanceof ExitError && err.code === 1,
    );
  });

  it('should exit with code 1 when --file is a boolean and another --file is provided later', () => {
    assert.throws(
      () => parseAndValidate(['--file', '--json', '--file', 'path', '/repo']),
      (err) => err instanceof ExitError && err.code === 1,
    );
  });
});

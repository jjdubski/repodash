import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert';

let fetchUserRepos;

before(async () => {
  const mod = await import('../src/github.js');
  fetchUserRepos = mod.fetchUserRepos;
});

describe('fetchUserRepos', () => {
  /** @type {typeof globalThis.fetch} */
  let origFetch;

  const mockRepos = [
    {
      name: 'repo1',
      full_name: 'user/repo1',
      clone_url: 'https://github.com/user/repo1.git',
      pushed_at: '2024-01-01T00:00:00Z',
      default_branch: 'main'
    },
    {
      name: 'repo2',
      full_name: 'user/repo2',
      clone_url: 'https://github.com/user/repo2.git',
      pushed_at: '2024-01-02T00:00:00Z',
      default_branch: 'main'
    }
  ];

  before(() => {
    origFetch = globalThis.fetch;
  });

  after(() => {
    globalThis.fetch = origFetch;
  });

  it('should return an array of repo objects for a valid username', async () => {
    globalThis.fetch = mock.fn(async (url, opts) => {
      assert.ok(url.includes('/users/testuser/repos'));
      assert.strictEqual(opts.headers['User-Agent'], 'repodash');
      return {
        ok: true,
        status: 200,
        headers: new Map(),
        json: async () => mockRepos
      };
    });

    const repos = await fetchUserRepos('testuser');
    assert.strictEqual(repos.length, 2);
    assert.strictEqual(repos[0].name, 'repo1');
    assert.strictEqual(repos[0].fullName, 'user/repo1');
    assert.strictEqual(repos[0].cloneUrl, 'https://github.com/user/repo1.git');
    assert.strictEqual(repos[0].pushedAt, '2024-01-01T00:00:00Z');
    assert.strictEqual(repos[0].defaultBranch, 'main');
  });

  it('should include Bearer auth when token is provided', async () => {
    globalThis.fetch = mock.fn(async (url, opts) => {
      assert.strictEqual(opts.headers.Authorization, 'Bearer ghp_test123');
      return {
        ok: true,
        status: 200,
        headers: new Map(),
        json: async () => [mockRepos[0]]
      };
    });

    const repos = await fetchUserRepos('testuser', 'ghp_test123');
    assert.strictEqual(repos.length, 1);
  });

  it('should handle pagination via Link header', async () => {
    let callCount = 0;
    globalThis.fetch = mock.fn(async (url) => {
      callCount++;
      const link = callCount === 1 ? '<https://api.github.com/user/repos?page=2>; rel="next"' : '';
      return {
        ok: true,
        status: 200,
        headers: new Map([['link', link]]),
        json: async () => [mockRepos[callCount - 1]]
      };
    });

    const repos = await fetchUserRepos('testuser');
    assert.strictEqual(callCount, 2);
    assert.strictEqual(repos.length, 2);
  });

  it('should filter out repos without pushed_at', async () => {
    globalThis.fetch = mock.fn(async () => {
      return {
        ok: true,
        status: 200,
        headers: new Map(),
        json: async () => [
          mockRepos[0],
          {
            name: 'empty',
            full_name: 'user/empty',
            clone_url: 'https://github.com/user/empty.git',
            pushed_at: null,
            default_branch: 'main'
          }
        ]
      };
    });

    const repos = await fetchUserRepos('testuser');
    assert.strictEqual(repos.length, 1);
    assert.strictEqual(repos[0].name, 'repo1');
  });

  it('should throw on non-ok response', async () => {
    globalThis.fetch = mock.fn(async () => {
      return {
        ok: false,
        status: 404,
        statusText: 'Not Found'
      };
    });

    await assert.rejects(() => fetchUserRepos('nonexistent'), /GitHub API error: 404 Not Found/);
  });
});

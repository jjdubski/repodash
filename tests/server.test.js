import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import http from 'node:http';
import { serveDashboard } from '../src/server.js';

// ---------------------------------------------------------------------------
// Fixture setup — runs once for the entire suite
// ---------------------------------------------------------------------------

let testDashboardDir;
let testData;

before(() => {
  // Create a minimal dashboard directory to simulate the bundled UI
  testDashboardDir = mkdtempSync(join(tmpdir(), 'repodash-test-dashboard-'));
  writeFileSync(join(testDashboardDir, 'index.html'), '<h1>Test Dashboard</h1>');
  writeFileSync(join(testDashboardDir, 'style.css'), 'body { color: red; }');
  writeFileSync(join(testDashboardDir, 'dashboard.js'), 'console.log("test");');
  writeFileSync(join(testDashboardDir, 'chart-config.js'), '// config');

  // Sample aggregated data matching the shape produced by src/aggregate.js
  testData = {
    summary: {
      totalCommits: 100,
      totalContributors: 5,
      totalAdditions: 1000,
      totalDeletions: 500,
      firstCommit: '2024-01-01',
      lastCommit: '2025-01-01',
      activeBranches: 2
    },
    contributions: [
      {
        date: '2025-01-15',
        count: 5,
        authorDetails: [{ author: 'test', count: 5 }]
      }
    ],
    contributors: [
      {
        name: 'test',
        email: 'test@test.com',
        totalCommits: 100,
        additions: 1000,
        deletions: 500,
        firstCommit: '2024-01-01',
        lastCommit: '2025-01-01'
      }
    ],
    frequency: [{ date: '2025-01-15', additions: 100, deletions: 50 }],
    activity: {
      byDayOfWeek: [{ day: 'Mon', count: 10 }],
      byHour: [{ hour: 9, count: 5 }],
      topFiles: [{ path: 'src/index.js', changes: 20 }]
    }
  };
});

after(() => {
  rmSync(testDashboardDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('serveDashboard', () => {
  /** @type {{ port: number, tmpDir: string, server: import('node:http').Server }} */
  let handle;

  before(async () => {
    handle = await serveDashboard(testData, testDashboardDir, 0);
  });

  after(async () => {
    if (!handle) return;
    await new Promise((resolve) => handle.server.close(resolve));
    rmSync(handle.tmpDir, { recursive: true, force: true });
  });

  // ----- 1. Server starts and returns expected shape -----------------------

  it('should return { port, tmpDir, server } with a positive port number', () => {
    assert.ok(handle.port > 0, `Expected positive port, got ${handle.port}`);
    assert.ok(Number.isInteger(handle.port), 'port must be an integer');
    assert.strictEqual(typeof handle.tmpDir, 'string');
    assert.ok(handle.tmpDir.length > 0, 'tmpDir should not be empty');
    assert.ok(handle.server, 'server must be defined');
    assert.strictEqual(typeof handle.server.close, 'function');
  });

  // ----- 2. No dangling error listener after port-0 bind -------------------

  it('should leave no dangling error listener after binding on OS-assigned port', () => {
    assert.strictEqual(
      handle.server.listenerCount('error'),
      0,
      'bindServer must clean up its error listener after a successful port-0 bind'
    );
  });

  // ----- 3. Data JSON files are written ------------------------------------

  it('should write all 4 JSON data files to tmpDir/data/', () => {
    const dataDir = join(handle.tmpDir, 'data');
    const expectedFiles = [
      'summary.json',
      'contributions.json',
      'contributors.json',
      'frequency.json'
    ];

    for (const file of expectedFiles) {
      const filePath = join(dataDir, file);
      assert.ok(existsSync(filePath), `Missing data file: ${file}`);

      // Verify that each file contains valid JSON
      const parsed = JSON.parse(readFileSync(filePath, 'utf-8'));
      assert.ok(parsed !== null, `${file} should contain valid JSON`);
    }

    // Deep-compare summary.json against the input data as a correctness check
    const summary = JSON.parse(readFileSync(join(dataDir, 'summary.json'), 'utf-8'));
    assert.deepStrictEqual(summary, testData.summary);
  });

  // ----- 3 + 4. HTTP endpoints and MIME types -----------------------------

  describe('HTTP endpoints', () => {
    async function assertFetch(path, { status = 200, type, bodyIncludes, bodyDeep } = {}) {
      const res = await fetch(`http://localhost:${handle.port}${path}`);
      assert.strictEqual(res.status, status);
      if (type) assert.strictEqual(res.headers.get('content-type'), type);
      if (bodyIncludes) assert.ok((await res.text()).includes(bodyIncludes));
      if (bodyDeep) assert.deepStrictEqual(await res.json(), bodyDeep);
    }

    it('should serve /index.html with status 200 and text/html', async () => {
      await assertFetch('/index.html', {
        status: 200,
        type: 'text/html',
        bodyIncludes: 'Test Dashboard'
      });
    });

    it('should serve /style.css with status 200 and text/css', async () => {
      await assertFetch('/style.css', {
        status: 200,
        type: 'text/css',
        bodyIncludes: 'color: red'
      });
    });

    it('should serve /dashboard.js with status 200 and application/javascript', async () => {
      await assertFetch('/dashboard.js', {
        status: 200,
        type: 'application/javascript',
        bodyIncludes: 'console.log'
      });
    });

    it('should serve /data/summary.json with status 200 and application/json', async () => {
      await assertFetch('/data/summary.json', {
        status: 200,
        type: 'application/json',
        bodyDeep: testData.summary
      });
    });

    it('should serve /data/contributions.json with correct data', async () => {
      await assertFetch('/data/contributions.json', {
        status: 200,
        type: 'application/json',
        bodyDeep: testData.contributions
      });
    });

    it('should serve / (root) with index.html content', async () => {
      await assertFetch('/', { status: 200, type: 'text/html', bodyIncludes: 'Test Dashboard' });
    });

    it('should return 404 for nonexistent files', async () => {
      await assertFetch('/nonexistent.html', {
        status: 404,
        type: 'text/plain',
        bodyIncludes: 'Not Found'
      });
    });
  });

  // ----- 5. Specific port --------------------------------------------------
  // NOTE: Each ephemeral server is created, tested, and cleaned up entirely
  // within the it() callback via try/finally. This avoids storing http.Server
  // objects in describe-block closures, which would trigger the Node.js test
  // runner's "Unable to deserialize cloned data" error during IPC serialization.

  it('should start on the requested port', async () => {
    const requestedPort = 19876;
    const h = await serveDashboard(testData, testDashboardDir, requestedPort);

    try {
      assert.strictEqual(
        h.port,
        requestedPort,
        `Expected server to bind to ${requestedPort}, got ${h.port}`
      );

      // Quick sanity check: the server is actually listening
      const res = await fetch(`http://localhost:${h.port}/index.html`);
      assert.strictEqual(res.status, 200);
    } finally {
      await new Promise((resolve) => h.server.close(resolve));
      rmSync(h.tmpDir, { recursive: true, force: true });
    }
  });

  // ----- 6. Missing dashboardDir (warns but doesn't crash) -----------------

  it('should not throw when dashboardDir does not exist', async () => {
    const fakeDir = join(tmpdir(), 'does-not-exist-xxxxxxxx');

    // Should resolve without throwing even though the dashboard dir
    // is missing (the server can still serve data endpoints)
    const h = await serveDashboard(testData, fakeDir, 0);

    try {
      assert.ok(h, 'should return a handle');
      assert.ok(h.port > 0, 'should have a positive port');

      // Data endpoints should still work even without the dashboard UI
      const res = await fetch(`http://localhost:${h.port}/data/summary.json`);
      assert.strictEqual(res.status, 200);

      const body = await res.json();
      assert.deepStrictEqual(body, testData.summary);
    } finally {
      await new Promise((resolve) => h.server.close(resolve));
      rmSync(h.tmpDir, { recursive: true, force: true });
    }
  });

  // ----- 7. Regression: EADDRINUSE retry path (no listener leak) -----------

  it('should retry on EADDRINUSE and leave zero error listeners', async () => {
    const occupiedPort = 20789;

    // Occupy the port with a throwaway server so serveDashboard hits EADDRINUSE
    const occupyingServer = http.createServer();
    await new Promise((resolve, reject) => {
      occupyingServer.on('error', reject);
      occupyingServer.listen(occupiedPort, resolve);
    });
    occupyingServer.removeAllListeners('error');

    /** @type {{ port: number, tmpDir: string, server: import('node:http').Server }|null} */
    let h = null;

    try {
      h = await serveDashboard(testData, testDashboardDir, occupiedPort);

      // Must have retried to a port in the retry range
      assert.ok(
        h.port > occupiedPort && h.port <= occupiedPort + 10,
        `Expected EADDRINUSE retry to bind to a port between ${occupiedPort + 1} and ${occupiedPort + 10}, got ${h.port}`
      );

      // No dangling error listener after the retry path resolves
      assert.strictEqual(
        h.server.listenerCount('error'),
        0,
        'bindServer must clean up error listener after EADDRINUSE retry'
      );

      // Sanity: the retried server is actually listening
      const res = await fetch(`http://localhost:${h.port}/index.html`);
      assert.strictEqual(res.status, 200);
    } finally {
      if (h) {
        await new Promise((resolve) => h.server.close(resolve));
        rmSync(h.tmpDir, { recursive: true, force: true });
      }
      await new Promise((resolve) => occupyingServer.close(resolve));
    }
  });
});

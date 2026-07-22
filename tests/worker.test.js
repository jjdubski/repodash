import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import {
  filterByDate,
  computeFilteredSummary,
  computeFilteredContributors,
  computeFilteredActivity,
  downsampleData,
  sortContributors,
  getCutoffDate
} from '../dashboard/filter.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DASHBOARD_DIR = join(__dirname, '..', 'dashboard');

function read(file) {
  return readFileSync(join(DASHBOARD_DIR, file), 'utf-8');
}

function createWorkerSandbox() {
  const postedMessages = [];
  const sandbox = {
    globalThis: {},
    self: {
      postMessage(msg) {
        postedMessages.push(msg);
      }
    },
    filterByDate,
    computeFilteredSummary,
    computeFilteredContributors,
    computeFilteredActivity,
    downsampleData,
    MAX_CHART_POINTS: 500,
    sortContributors,
    getCutoffDate,
    console: { error: function () {} },
    postedMessages
  };
  sandbox.globalThis.onmessage = null;
  return sandbox;
}

function runWorker(sandbox) {
  const src = read('worker.js');
  const processed = src.replace(/import\s*\{[\s\S]*?\}\s*from\s*['"][^'"]+['"]\s*;?\s*/m, '');
  const ctx = vm.createContext(sandbox);
  vm.runInContext(processed, ctx);
  return ctx;
}

describe('Web Worker (worker.js) — message handling', () => {
  it('should post ready on init message', () => {
    const sandbox = createWorkerSandbox();
    const ctx = runWorker(sandbox);

    ctx.globalThis.onmessage({
      data: {
        type: 'init',
        data: {
          contributions: [{ date: '2024-01-01', count: 1 }],
          contributors: [],
          frequency: [],
          summary: {}
        }
      }
    });

    assert.strictEqual(sandbox.postedMessages.length, 1);
    assert.strictEqual(sandbox.postedMessages[0].type, 'ready');
  });

  it('should post error when filter received before init', () => {
    const sandbox = createWorkerSandbox();
    const ctx = runWorker(sandbox);

    ctx.globalThis.onmessage({
      data: {
        type: 'filter',
        requestId: 99,
        filter: 'allTime',
        activeTab: 'overview'
      }
    });

    assert.strictEqual(sandbox.postedMessages.length, 1);
    const msg = sandbox.postedMessages[0];
    assert.strictEqual(msg.type, 'error');
    assert.strictEqual(msg.requestId, 99);
    assert.ok(msg.message.includes('Not initial'));
  });

  it('should post ready on reset message', () => {
    const sandbox = createWorkerSandbox();
    const ctx = runWorker(sandbox);

    ctx.globalThis.onmessage({
      data: { type: 'reset' }
    });

    assert.strictEqual(sandbox.postedMessages.length, 1);
    assert.strictEqual(sandbox.postedMessages[0].type, 'ready');
  });

  it('should reset rawData to null on reset', () => {
    const sandbox = createWorkerSandbox();
    const ctx = runWorker(sandbox);

    ctx.globalThis.onmessage({
      data: {
        type: 'init',
        data: {
          contributions: [{ date: '2024-01-01', count: 1 }],
          contributors: [],
          frequency: [],
          summary: {}
        }
      }
    });

    sandbox.postedMessages.length = 0;

    ctx.globalThis.onmessage({
      data: { type: 'reset' }
    });

    assert.strictEqual(sandbox.postedMessages.length, 1);
    assert.strictEqual(sandbox.postedMessages[0].type, 'ready');

    sandbox.postedMessages.length = 0;

    ctx.globalThis.onmessage({
      data: {
        type: 'filter',
        requestId: 1,
        filter: 'allTime',
        activeTab: 'overview'
      }
    });

    assert.strictEqual(sandbox.postedMessages[0].type, 'error');
  });

  it('should return result with summary + contributors for overview tab', () => {
    const sandbox = createWorkerSandbox();
    const ctx = runWorker(sandbox);

    ctx.globalThis.onmessage({
      data: {
        type: 'init',
        data: {
          contributions: [
            {
              date: '2024-01-01',
              count: 5,
              authorDetails: [
                { author: 'Alice', email: 'a@t.com', count: 3, additions: 30, deletions: 5 },
                { author: 'Bob', email: 'b@t.com', count: 2, additions: 10, deletions: 2 }
              ]
            },
            {
              date: '2024-06-15',
              count: 3,
              authorDetails: [
                { author: 'Alice', email: 'a@t.com', count: 3, additions: 20, deletions: 1 }
              ]
            }
          ],
          contributors: [
            {
              name: 'Alice',
              email: 'a@t.com',
              totalCommits: 6,
              firstCommit: '2024-01-01',
              lastCommit: '2024-06-15'
            },
            {
              name: 'Bob',
              email: 'b@t.com',
              totalCommits: 2,
              firstCommit: '2024-01-01',
              lastCommit: '2024-01-01'
            }
          ],
          frequency: [
            { date: '2024-01-01', additions: 40, deletions: 7 },
            { date: '2024-06-15', additions: 20, deletions: 1 }
          ],
          summary: {}
        }
      }
    });

    sandbox.postedMessages.length = 0;

    ctx.globalThis.onmessage({
      data: {
        type: 'filter',
        requestId: 1,
        filter: 'allTime',
        activeTab: 'overview'
      }
    });

    assert.strictEqual(sandbox.postedMessages.length, 1);
    const msg = sandbox.postedMessages[0];
    assert.strictEqual(msg.type, 'result');
    assert.strictEqual(msg.requestId, 1);
    assert.ok(msg.data, 'result data should be present');
    assert.ok(msg.data.summary, 'overview tab should include summary');
    assert.strictEqual(msg.data.summary.totalCommits, 8);
    assert.ok(msg.data.contributors, 'overview tab should include contributors');
    assert.strictEqual(msg.data.contributors.length, 2);
    assert.ok(msg.data.frequency, 'overview tab should include frequency');
    assert.strictEqual(msg.data.frequency.length, 2);
  });

  it('should return result with sorted contributors for contributors tab', () => {
    const sandbox = createWorkerSandbox();
    const ctx = runWorker(sandbox);

    ctx.globalThis.onmessage({
      data: {
        type: 'init',
        data: {
          contributions: [
            {
              date: '2024-01-01',
              count: 5,
              authorDetails: [
                { author: 'Alice', email: 'a@t.com', count: 3, additions: 30, deletions: 5 },
                { author: 'Bob', email: 'b@t.com', count: 2, additions: 10, deletions: 2 }
              ]
            }
          ],
          contributors: [
            {
              name: 'Bob',
              email: 'b@t.com',
              totalCommits: 2,
              firstCommit: '2024-01-01',
              lastCommit: '2024-01-01'
            },
            {
              name: 'Alice',
              email: 'a@t.com',
              totalCommits: 3,
              firstCommit: '2024-01-01',
              lastCommit: '2024-01-01'
            }
          ],
          frequency: [],
          summary: {}
        }
      }
    });

    sandbox.postedMessages.length = 0;

    ctx.globalThis.onmessage({
      data: {
        type: 'filter',
        requestId: 2,
        filter: 'allTime',
        activeTab: 'contributors',
        sortBy: 'commits',
        sortOrder: 'desc'
      }
    });

    assert.strictEqual(sandbox.postedMessages.length, 1);
    const msg = sandbox.postedMessages[0];
    assert.strictEqual(msg.type, 'result');
    assert.strictEqual(msg.requestId, 2);
    assert.ok(msg.data.contributors, 'contributors tab should include contributors');
    assert.strictEqual(msg.data.contributors[0].name, 'Alice');
    assert.strictEqual(msg.data.contributors.length, 2);
  });

  it('should return result with activity for activity tab', () => {
    const sandbox = createWorkerSandbox();
    const ctx = runWorker(sandbox);

    ctx.globalThis.onmessage({
      data: {
        type: 'init',
        data: {
          contributions: [
            {
              date: '2024-01-01',
              count: 3,
              authorDetails: [
                { author: 'Alice', email: 'a@t.com', count: 3, additions: 30, deletions: 5 }
              ]
            }
          ],
          contributors: [
            {
              name: 'Alice',
              email: 'a@t.com',
              totalCommits: 3,
              firstCommit: '2024-01-01',
              lastCommit: '2024-01-01'
            }
          ],
          frequency: [],
          summary: {}
        }
      }
    });

    sandbox.postedMessages.length = 0;

    ctx.globalThis.onmessage({
      data: {
        type: 'filter',
        requestId: 3,
        filter: 'allTime',
        activeTab: 'activity'
      }
    });

    assert.strictEqual(sandbox.postedMessages.length, 1);
    const msg = sandbox.postedMessages[0];
    assert.strictEqual(msg.type, 'result');
    assert.strictEqual(msg.requestId, 3);
    assert.ok(msg.data.activity, 'activity tab should include activity');
    assert.ok(msg.data.activity.byDayOfWeek, 'activity should have byDayOfWeek');
    assert.ok(msg.data.activity.byHour, 'activity should have byHour');
    assert.ok(msg.data.fullContributions, 'activity tab should include fullContributions');
    assert.ok(msg.data.contributors, 'activity tab should include contributors');
  });

  it('should apply date bounds for non-allTime filters', () => {
    const sandbox = createWorkerSandbox();
    const ctx = runWorker(sandbox);

    ctx.globalThis.onmessage({
      data: {
        type: 'init',
        data: {
          contributions: [
            { date: '2020-01-01', count: 1, authorDetails: [] },
            { date: '2024-06-15', count: 2, authorDetails: [] }
          ],
          contributors: [],
          frequency: [],
          summary: {}
        }
      }
    });

    sandbox.postedMessages.length = 0;

    ctx.globalThis.onmessage({
      data: {
        type: 'filter',
        requestId: 4,
        filter: 'pastYear',
        activeTab: 'overview'
      }
    });

    const msg = sandbox.postedMessages[0];
    assert.strictEqual(msg.type, 'result');
    assert.ok(msg.data.contributions.length <= 2, 'should filter by date');
  });

  it('should handle unknown message type gracefully', () => {
    const sandbox = createWorkerSandbox();
    const ctx = runWorker(sandbox);

    ctx.globalThis.onmessage({
      data: { type: 'unknown' }
    });

    assert.strictEqual(sandbox.postedMessages.length, 0, 'unknown message type should be ignored');
  });
});

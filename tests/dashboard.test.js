/* ═════════════════════════════════════════════════════════════════════
   Insights Dashboard — Tests (Phase 6)
   ═════════════════════════════════════════════════════════════════════
   Tests cover:
     1. File structure — all 4 dashboard files, CSS custom properties,
        HTML structure, CDN link, tabs, canvases
     2. chart-config.js — COLORS, CHART_DEFAULTS, getScaleDefaults,
        getTextColor via vm sandbox
     3. dashboard.js — pure utility functions extracted via brace-
        counting and evaluated in isolation
   ═════════════════════════════════════════════════════════════════════ */

import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

// ── Paths ──────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const DASHBOARD_DIR = join(__dirname, '..', 'dashboard');

// ── Helpers ────────────────────────────────────────────────────────────────

function read(file) {
  return readFileSync(join(DASHBOARD_DIR, file), 'utf-8');
}

function exists(file) {
  return existsSync(join(DASHBOARD_DIR, file));
}

/**
 * Extract a function body from source text by counting brace depth.
 *
 * Works correctly even when the function body contains nested braces
 * (if/for/switch/try/etc.) because it tracks depth, not just regex.
 *
 * @param {string} name   Function name to find
 * @param {string} src    Full source text
 * @returns {string|null} Function source including the `function` keyword
 */
function extractFunction(name, src) {
  const re = new RegExp(
    `function\\s+${name}\\s*\\([^)]*\\)\\s*\\{`,
  );
  const match = re.exec(src);
  if (!match) return null;

  const start = match.index;
  let depth = 0;
  let i = match.index;

  // Advance past the opening brace
  while (i < src.length && src[i] !== '{') i++;
  depth = 1;
  i++;

  while (i < src.length && depth > 0) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') depth--;
    i++;
  }

  return src.slice(start, i);
}

/**
 * Evaluate a function source string and return the function object.
 * Works for both function declarations and function expressions.
 */
function evalFunction(fnSrc) {
  // Wrap to make it an expression (so it evaluates to the function object)
  return eval('(' + fnSrc + ')');
}

// ═══════════════════════════════════════════════════════════════════════════
//  1. FILE STRUCTURE TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe('Dashboard — file structure', () => {
  it('should have all 4 dashboard files', () => {
    assert.ok(exists('index.html'),      'Missing: index.html');
    assert.ok(exists('style.css'),       'Missing: style.css');
    assert.ok(exists('chart-config.js'), 'Missing: chart-config.js');
    assert.ok(exists('dashboard.js'),    'Missing: dashboard.js');
  });

  describe('CSS (style.css)', () => {
    let css;

    before(() => { css = read('style.css'); });

    it('should define CSS custom properties for theming', () => {
      assert.ok(css.includes('--bg'),     'Missing --bg');
      assert.ok(css.includes('--text'),   'Missing --text');
      assert.ok(css.includes('--accent'), 'Missing --accent');
      assert.ok(css.includes('--green'),  'Missing --green');
      assert.ok(css.includes('--red'),    'Missing --red');
    });

    it('should have a [data-theme="dark"] selector', () => {
      assert.ok(css.includes('[data-theme="dark"]'));
    });

    it('should respect prefers-reduced-motion', () => {
      assert.ok(
        css.includes('@media (prefers-reduced-motion: reduce)'),
        'Missing prefers-reduced-motion media query',
      );
    });

    it('should define responsive breakpoints', () => {
      assert.ok(
        css.includes('@media (max-width: 900px)'),
        'Missing tablet breakpoint',
      );
      assert.ok(
        css.includes('@media (max-width: 560px)'),
        'Missing mobile breakpoint',
      );
    });
  });

  describe('HTML (index.html)', () => {
    let html;

    before(() => { html = read('index.html'); });

    it('should have a main content container', () => {
      const hasMain = html.includes('<main') || html.includes('id="app"');
      assert.ok(hasMain, 'No <main> element or #app container found');
    });

    it('should have a theme toggle button (#theme-toggle)', () => {
      assert.ok(html.includes('theme-toggle'), 'Missing theme toggle');
    });

    it('should link to Chart.js CDN', () => {
      assert.ok(
        html.includes('chart.js'),
        'No Chart.js script reference',
      );
      assert.ok(
        html.includes('cdn.jsdelivr.net'),
        'Not using jsdelivr CDN',
      );
    });

    it('should have chart-config.js and dashboard.js scripts', () => {
      assert.ok(html.includes('chart-config.js'));
      assert.ok(html.includes('dashboard.js'));
    });

    it('should have all 4 tab labels', () => {
      assert.ok(html.includes('Overview'));
      assert.ok(html.includes('Contributors'));
      assert.ok(html.includes('Code Frequency'));
      assert.ok(html.includes('Activity'));
    });

    it('should have tab navigation buttons with data-tab attributes', () => {
      const tabs = html.match(/data-tab="\w+"/g);
      assert.ok(tabs, 'No data-tab attributes found');
      assert.strictEqual(tabs.length, 4, 'Expected 4 tabs');
    });

    it('should have chart canvases', () => {
      const canvases = html.match(/<canvas/g);
      assert.ok(canvases, 'No <canvas> elements found');
      assert.ok(
        canvases.length >= 5,
        `Expected at least 5 canvases, got ${canvases.length}`,
      );
    });

    it('should have time filter pills', () => {
      const pills = html.match(/data-filter="\w+"/g);
      assert.ok(pills, 'No data-filter attributes found');
      assert.strictEqual(pills.length, 5, 'Expected 5 time filter pills');
    });

    it('should have custom date range inputs', () => {
      assert.ok(html.includes('id="custom-date-range"'), 'Missing custom date range container');
      assert.ok(html.includes('id="date-start"'), 'Missing date-start input');
      assert.ok(html.includes('id="date-end"'), 'Missing date-end input');
    });

    it('should have loading / error / empty state elements', () => {
      assert.ok(html.includes('Loading'), 'Missing loading state');
      assert.ok(html.includes('-error'),  'Missing error state element');
      assert.ok(html.includes('-empty'),  'Missing empty state element');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  2. chart-config.js TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe('Dashboard — chart-config.js', () => {
  /** @type {vm.Context} */
  let sandbox;

  before(() => {
    // Build a realistic sandbox — Chart.js is loaded, DOM is stubbed
    sandbox = vm.createContext({
      Chart: {
        register: () => {},
        BarController:    {},
        LineController:   {},
        LineElement:      {},
        BarElement:       {},
        PointElement:     {},
        CategoryScale:    {},
        LinearScale:      {},
        Filler:           {},
      },
      window: {},
      console: { error: () => {} },
      getComputedStyle: () => ({
        getPropertyValue: () => '',
      }),
      document: { documentElement: {} },
    });

    vm.runInContext(read('chart-config.js'), sandbox);
  });

  describe('COLORS', () => {
    it('should be defined on window', () => {
      assert.ok(sandbox.window.COLORS, 'window.COLORS is undefined');
    });

    it('should have all 8 expected color keys', () => {
      const c = sandbox.window.COLORS;
      assert.strictEqual(typeof c.blue,   'string');
      assert.strictEqual(typeof c.green,  'string');
      assert.strictEqual(typeof c.amber,  'string');
      assert.strictEqual(typeof c.red,    'string');
      assert.strictEqual(typeof c.purple, 'string');
      assert.strictEqual(typeof c.orange, 'string');
      assert.strictEqual(typeof c.cyan,   'string');
      assert.strictEqual(typeof c.pink,   'string');
    });

    it('should all be valid 6-digit hex colours', () => {
      const hex6 = /^#[0-9a-fA-F]{6}$/;
      for (const [key, val] of Object.entries(sandbox.window.COLORS)) {
        assert.match(
          val,
          hex6,
          `COLORS.${key} is not a valid hex colour: "${val}"`,
        );
      }
    });
  });

  describe('COLOR_LIST', () => {
    it('should be an array of 8 hex colours', () => {
      const list = sandbox.window.COLOR_LIST;
      assert.ok(Array.isArray(list), 'COLOR_LIST is not an array');
      assert.strictEqual(list.length, 8);
      for (let i = 0; i < list.length; i++) {
        assert.match(list[i], /^#[0-9a-fA-F]{6}$/);
      }
    });

    it('should have the same colours as COLORS in the same order', () => {
      const c = sandbox.window.COLORS;
      const list = sandbox.window.COLOR_LIST;
      assert.strictEqual(list[0], c.blue);
      assert.strictEqual(list[1], c.green);
      assert.strictEqual(list[2], c.amber);
      assert.strictEqual(list[3], c.red);
      assert.strictEqual(list[4], c.purple);
      assert.strictEqual(list[5], c.orange);
      assert.strictEqual(list[6], c.cyan);
      assert.strictEqual(list[7], c.pink);
    });
  });

  describe('CHART_DEFAULTS', () => {
    it('should be defined on window with responsive=true', () => {
      const d = sandbox.window.CHART_DEFAULTS;
      assert.ok(d, 'CHART_DEFAULTS is undefined');
      assert.strictEqual(d.responsive, true);
      assert.strictEqual(d.maintainAspectRatio, false);
    });

    it('should have animation config with 400ms duration', () => {
      const d = sandbox.window.CHART_DEFAULTS;
      assert.ok(d.animation, 'Missing animation config');
      assert.strictEqual(d.animation.duration, 400);
    });

    it('should have plugin defaults (legend + tooltip)', () => {
      const d = sandbox.window.CHART_DEFAULTS;
      assert.ok(d.plugins, 'Missing plugins config');
      assert.ok(d.plugins.legend,  'Missing legend config');
      assert.ok(d.plugins.tooltip, 'Missing tooltip config');
      assert.strictEqual(d.plugins.legend.position, 'bottom');
      assert.strictEqual(d.plugins.tooltip.mode, 'index');
      assert.strictEqual(d.plugins.tooltip.intersect, false);
    });

    it('should have scale defaults (x + y)', () => {
      const d = sandbox.window.CHART_DEFAULTS;
      assert.ok(d.scales,   'Missing scales config');
      assert.ok(d.scales.x, 'Missing x scale');
      assert.ok(d.scales.y, 'Missing y scale');
      assert.strictEqual(d.scales.x.grid.display, false);
      assert.strictEqual(d.scales.y.beginAtZero, true);
    });
  });

  describe('helper functions', () => {
    it('should define getScaleDefaults on window', () => {
      assert.strictEqual(typeof sandbox.window.getScaleDefaults, 'function');
    });

    it('should define getTextColor on window', () => {
      assert.strictEqual(typeof sandbox.window.getTextColor, 'function');
    });
  });

  describe('graceful degradation', () => {
    it('should bail without error when Chart.js is not loaded', () => {
      const ctx = vm.createContext({
        Chart: undefined,
        window: {},
        console: { error: () => {} },
      });
      // Should not throw
      vm.runInContext(read('chart-config.js'), ctx);
      // COLORS must NOT be set because the guard returned early
      assert.strictEqual(ctx.window.COLORS, undefined);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  3. dashboard.js — PURE UTILITY FUNCTION TESTS
// ═══════════════════════════════════════════════════════════════════════════
//
// The pure functions (formatNumber, formatDate, getCutoffDate, filterByDate)
// are defined inside the IIFE and not exported. We extract each one via
// brace-counting and evaluate it in isolation — no DOM stubs needed.
//
// Note: escapeHtml (also defined in dashboard.js) depends on `document`
// and can only be verified in a browser or with a full DOM polyfill like
// jsdom.  This test suite skips it for that reason.
//
// Note: a `truncateText` function was mentioned in the spec but does NOT
// exist in the actual dashboard.js source — it is therefore not tested.

describe('Dashboard — dashboard.js (pure functions)', () => {
  /** @type {Function} */
  let formatNumber;
  /** @type {Function} */
  let formatDate;
  /** @type {Function} */
  let getCutoffDate;
  /** @type {Function} */
  let filterByDate;
  /** @type {Function} */
  let computeFilteredContributors;

  before(() => {
    const src = read('dashboard.js');

    const fnSrc = extractFunction('formatNumber', src);
    assert.ok(fnSrc, 'formatNumber not found in dashboard.js');
    formatNumber = evalFunction(fnSrc);

    formatDate = evalFunction(extractFunction('formatDate', src));
    assert.ok(formatDate, 'formatDate not found in dashboard.js');

    getCutoffDate = evalFunction(extractFunction('getCutoffDate', src));
    assert.ok(getCutoffDate, 'getCutoffDate not found in dashboard.js');

    filterByDate = evalFunction(extractFunction('filterByDate', src));
    assert.ok(filterByDate, 'filterByDate not found in dashboard.js');

    computeFilteredContributors = evalFunction(extractFunction('computeFilteredContributors', src));
    assert.ok(computeFilteredContributors, 'computeFilteredContributors not found in dashboard.js');
  });

  // ── formatNumber ─────────────────────────────────────────────────────────

  describe('formatNumber', () => {
    it('should format 999 as "999"', () => {
      assert.strictEqual(formatNumber(999), '999');
    });

    it('should format 0 as "0"', () => {
      assert.strictEqual(formatNumber(0), '0');
    });

    it('should format 1200 as "1.2K"', () => {
      assert.strictEqual(formatNumber(1200), '1.2K');
    });

    it('should format 1000 as "1.0K"', () => {
      assert.strictEqual(formatNumber(1000), '1.0K');
    });

    it('should format 1500000 as "1.5M"', () => {
      assert.strictEqual(formatNumber(1500000), '1.5M');
    });

    it('should format 1000000 as "1.0M"', () => {
      assert.strictEqual(formatNumber(1000000), '1.0M');
    });

    it('should format 999500 as "999.5K"', () => {
      assert.strictEqual(formatNumber(999500), '999.5K');
    });

    it('should format negative numbers with K/M suffix', () => {
      assert.strictEqual(formatNumber(-500), '-500');
      assert.strictEqual(formatNumber(-1200), '-1.2K');
      assert.strictEqual(formatNumber(-1500000), '-1.5M');
    });

    it('should return em-dash for null', () => {
      assert.strictEqual(formatNumber(null), '\u2014');
    });

    it('should return em-dash for undefined', () => {
      assert.strictEqual(formatNumber(undefined), '\u2014');
    });

    it('should return em-dash for NaN', () => {
      assert.strictEqual(formatNumber(NaN), '\u2014');
    });
  });

  // ── formatDate ───────────────────────────────────────────────────────────

  describe('formatDate', () => {
    it('should format a valid ISO date into a locale-aware string', () => {
      const result = formatDate('2024-01-15');
      // Should produce something like "Jan 15, 2024" — at minimum not the
      // em-dash and should contain some digits (proof the date was parsed)
      assert.notStrictEqual(result, '\u2014');
      assert.ok(/\d/.test(result), 'Expected digits in formatted date');
    });

    it('should return em-dash for null', () => {
      assert.strictEqual(formatDate(null), '\u2014');
    });

    it('should return em-dash for undefined', () => {
      assert.strictEqual(formatDate(undefined), '\u2014');
    });

    it('should return em-dash for empty string', () => {
      assert.strictEqual(formatDate(''), '\u2014');
    });

    it('should handle a full ISO datetime string', () => {
      const result = formatDate('2024-06-15T14:30:00Z');
      assert.notStrictEqual(result, '\u2014');
      assert.ok(/\d/.test(result));
    });
  });

  // ── getCutoffDate ────────────────────────────────────────────────────────

  describe('getCutoffDate', () => {
    it('should return null for "allTime"', () => {
      assert.strictEqual(getCutoffDate('allTime'), null);
    });

    it('should return bounds object with YYYY-MM-DD start for "thisWeek"', () => {
      const result = getCutoffDate('thisWeek');
      assert.ok(result, 'Expected truthy bounds object');
      assert.match(result.start, /^\d{4}-\d{2}-\d{2}$/);
      assert.strictEqual(result.end, null);
    });

    it('should return bounds object with YYYY-MM-DD start for "last3months"', () => {
      const result = getCutoffDate('last3months');
      assert.ok(result, 'Expected truthy bounds object');
      assert.match(result.start, /^\d{4}-\d{2}-\d{2}$/);
      assert.strictEqual(result.end, null);
    });

    it('should return bounds object with YYYY-MM-DD start for "pastYear"', () => {
      const result = getCutoffDate('pastYear');
      assert.ok(result, 'Expected truthy bounds object');
      assert.match(result.start, /^\d{4}-\d{2}-\d{2}$/);
      assert.strictEqual(result.end, null);
    });

    it('should return null for unknown filter values', () => {
      assert.strictEqual(getCutoffDate('unknown'), null);
    });
  });

  // ── filterByDate ─────────────────────────────────────────────────────────

  describe('filterByDate', () => {
    const data = [
      { date: '2024-01-01', val: 1 },
      { date: '2024-06-15', val: 2 },
      { date: '2024-12-31', val: 3 },
    ];

    it('should return the same array when bounds is null', () => {
      const result = filterByDate(data, null);
      assert.strictEqual(result, data);   // same reference
    });

    it('should filter out items before the start bound', () => {
      const result = filterByDate(data, { start: '2024-06-01', end: null });
      assert.strictEqual(result.length, 2);
      assert.strictEqual(result[0].val, 2);
      assert.strictEqual(result[1].val, 3);
    });

    it('should filter out items after the end bound', () => {
      const result = filterByDate(data, { start: null, end: '2024-06-30' });
      assert.strictEqual(result.length, 2);
      assert.strictEqual(result[0].val, 1);
      assert.strictEqual(result[1].val, 2);
    });

    it('should filter both bounds when start and end are set', () => {
      const result = filterByDate(data, { start: '2024-02-01', end: '2024-11-30' });
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].val, 2);
    });

    it('should return all items when both bounds are null', () => {
      const result = filterByDate(data, { start: null, end: null });
      assert.strictEqual(result.length, 3);
    });

    it('should filter out all items when start is after all dates', () => {
      const result = filterByDate(data, { start: '2099-01-01', end: null });
      assert.strictEqual(result.length, 0);
    });

    it('should filter out all items when end is before all dates', () => {
      const result = filterByDate(data, { start: null, end: '2020-01-01' });
      assert.strictEqual(result.length, 0);
    });

    it('should return the same array for empty input', () => {
      const empty = [];
      const result = filterByDate(empty, { start: '2024-01-01', end: null });
      assert.strictEqual(result, empty);
    });

    it('should return null for null input', () => {
      assert.strictEqual(filterByDate(null, { start: '2024-01-01', end: null }), null);
    });

    it('should return undefined for undefined input', () => {
      assert.strictEqual(filterByDate(undefined, { start: '2024-01-01', end: null }), undefined);
    });

    it('should use a custom field name when provided', () => {
      const d = [
        { created: '2023-01-01' },
        { created: '2024-06-01' },
      ];
      const result = filterByDate(d, { start: '2024-01-01', end: null }, 'created');
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].created, '2024-06-01');
    });

    it('should default to "date" field when field is not supplied', () => {
      const d = [
        { date: '2023-01-01' },
        { date: '2024-06-01' },
      ];
      const result = filterByDate(d, { start: '2024-01-01', end: null });
      assert.strictEqual(result.length, 1);
    });
  });

  // ── computeFilteredContributors ───────────────────────────────────────────

  describe('computeFilteredContributors', () => {
    it('should return separate contributors for same name with different emails', () => {
      const contributions = [
        {
          date: '2025-01-15',
          count: 3,
          authorDetails: [
            { author: 'Alice', email: 'alice@work.com', count: 2, additions: 20, deletions: 5 },
            { author: 'Alice', email: 'alice@personal.com', count: 1, additions: 10, deletions: 2 },
          ],
        },
      ];

      const allContributors = [
        {
          name: 'Alice',
          email: 'alice@work.com',
          totalCommits: 2,
          additions: 20,
          deletions: 5,
          firstCommit: '2025-01-15T10:00:00Z',
          lastCommit: '2025-01-15T14:00:00Z',
        },
        {
          name: 'Alice',
          email: 'alice@personal.com',
          totalCommits: 1,
          additions: 10,
          deletions: 2,
          firstCommit: '2025-01-15T16:00:00Z',
          lastCommit: '2025-01-15T16:00:00Z',
        },
      ];

      const result = computeFilteredContributors(contributions, allContributors);

      assert.strictEqual(result.length, 2);
      // Sorted by totalCommits desc: alice@work.com (2) before alice@personal.com (1)
      assert.strictEqual(result[0].email, 'alice@work.com');
      assert.strictEqual(result[0].totalCommits, 2);
      assert.strictEqual(result[0].additions, 20);
      assert.strictEqual(result[0].deletions, 5);
      assert.strictEqual(result[0].name, 'Alice');

      assert.strictEqual(result[1].email, 'alice@personal.com');
      assert.strictEqual(result[1].totalCommits, 1);
      assert.strictEqual(result[1].additions, 10);
      assert.strictEqual(result[1].deletions, 2);
      assert.strictEqual(result[1].name, 'Alice');
    });

    it('should use email field for contributor lookups when email is available in authorDetails', () => {
      const contributions = [
        {
          date: '2025-01-15',
          count: 2,
          authorDetails: [
            { author: 'User', email: 'email1@test.com', count: 1, additions: 5, deletions: 1 },
            { author: 'User', email: 'email2@test.com', count: 1, additions: 10, deletions: 2 },
          ],
        },
      ];

      const allContributors = [
        {
          name: 'User',
          email: 'email1@test.com',
          totalCommits: 1,
          additions: 5,
          deletions: 1,
          firstCommit: '2025-01-15',
          lastCommit: '2025-01-15',
        },
        {
          name: 'User',
          email: 'email2@test.com',
          totalCommits: 1,
          additions: 10,
          deletions: 2,
          firstCommit: '2025-01-15',
          lastCommit: '2025-01-15',
        },
      ];

      const result = computeFilteredContributors(contributions, allContributors);

      // Two separate entries — email is the key, not author name
      assert.strictEqual(result.length, 2);
      const emails = result.map((c) => c.email).sort();
      assert.deepStrictEqual(emails, ['email1@test.com', 'email2@test.com']);
    });
  });
});

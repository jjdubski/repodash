/* ═════════════════════════════════════════════════════════════════════
   Insights Dashboard — Tests
   ═════════════════════════════════════════════════════════════════════
   Tests cover:
     1. File structure — all 4 dashboard files, CSS custom properties,
        HTML structure, CDN link, tabs, canvases
     2. chart-config.js — COLORS, CHART_DEFAULTS, getScaleDefaults,
        getTextColor via vm sandbox
     3. dashboard.js — pure utility functions extracted via brace-
        counting and evaluated in isolation
     4. dashboard.js — stateful functions tested via vm sandbox with
        stubs for DOM/state dependencies
   ═════════════════════════════════════════════════════════════════════ */

import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import {
  formatNumber,
  formatDate,
  getCutoffDate,
  filterByDate,
  computeFilteredContributors,
  computeFilteredActivity,
  clampDate
} from '../dashboard/dashboard.js';

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
  const re = new RegExp(String.raw`function\s+${name}\s*\([^)]*\)\s*\{`);
  const match = re.exec(src);
  if (!match) return null;

  const start = match.index;
  let i = match.index;

  // Advance past the opening brace
  while (i < src.length && src[i] !== '{') i++;
  let depth = 1;
  i++;

  while (i < src.length && depth > 0) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') depth--;
    i++;
  }

  return src.slice(start, i);
}

function loadFn(name, sandbox) {
  const ctx = vm.createContext(sandbox);
  const src = read('dashboard.js');
  const fnSrc = extractFunction(name, src);
  if (!fnSrc) throw new Error(`${name} not found in dashboard.js`);
  return vm.runInContext('(' + fnSrc + ')', ctx);
}

function make24(fills) {
  const arr = new Array(24);
  for (let i = 0; i < 24; i++) arr[i] = { hour: i, count: 0 };
  Object.keys(fills).forEach(function (h) {
    arr[Number(h)] = { hour: Number(h), count: fills[h] };
  });
  return arr;
}

// ═══════════════════════════════════════════════════════════════════════════
//  1. FILE STRUCTURE TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe('Dashboard — file structure', () => {
  it('should have all 4 dashboard files', () => {
    assert.ok(exists('index.html'), 'Missing: index.html');
    assert.ok(exists('style.css'), 'Missing: style.css');
    assert.ok(exists('chart-config.js'), 'Missing: chart-config.js');
    assert.ok(exists('dashboard.js'), 'Missing: dashboard.js');
  });

  describe('CSS (style.css)', () => {
    let css;

    before(() => {
      css = read('style.css');
    });

    it('should define CSS custom properties for theming', () => {
      assert.ok(css.includes('--bg'), 'Missing --bg');
      assert.ok(css.includes('--text'), 'Missing --text');
      assert.ok(css.includes('--accent'), 'Missing --accent');
      assert.ok(css.includes('--green'), 'Missing --green');
      assert.ok(css.includes('--red'), 'Missing --red');
    });

    it('should have a [data-theme="dark"] selector', () => {
      assert.ok(css.includes('[data-theme="dark"]'));
    });

    it('should respect prefers-reduced-motion', () => {
      assert.ok(
        css.includes('@media (prefers-reduced-motion: reduce)'),
        'Missing prefers-reduced-motion media query'
      );
    });

    it('should define responsive breakpoints', () => {
      assert.ok(css.includes('@media (max-width: 900px)'), 'Missing tablet breakpoint');
      assert.ok(css.includes('@media (max-width: 560px)'), 'Missing mobile breakpoint');
    });
  });

  describe('HTML (index.html)', () => {
    let html;

    before(() => {
      html = read('index.html');
    });

    it('should have a main content container', () => {
      const hasMain = html.includes('<main') || html.includes('id="app"');
      assert.ok(hasMain, 'No <main> element or #app container found');
    });

    it('should have a theme toggle button (#theme-toggle)', () => {
      assert.ok(html.includes('theme-toggle'), 'Missing theme toggle');
    });

    it('should link to Chart.js CDN', () => {
      assert.ok(html.includes('chart.js'), 'No Chart.js script reference');
      assert.ok(html.includes('cdn.jsdelivr.net'), 'Not using jsdelivr CDN');
    });

    it('should have chart-config.js and dashboard.js scripts', () => {
      assert.ok(html.includes('chart-config.js'));
      assert.ok(html.includes('dashboard.js'));
    });

    it('should have all 3 tab labels', () => {
      assert.ok(html.includes('Overview'));
      assert.ok(html.includes('Contributors'));
      assert.ok(html.includes('Activity'));
    });

    it('should have tab navigation buttons with data-tab attributes', () => {
      const tabs = html.match(/data-tab="\w+"/g);
      assert.ok(tabs, 'No data-tab attributes found');
      assert.strictEqual(tabs.length, 3, 'Expected 3 tabs');
    });

    it('should have chart canvases', () => {
      const canvases = html.match(/<canvas/g);
      assert.ok(canvases, 'No <canvas> elements found');
      assert.ok(canvases.length >= 6, `Expected at least 6 canvases, got ${canvases.length}`);
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

    it('should have error / empty state elements', () => {
      assert.ok(html.includes('-error'), 'Missing error state element');
      assert.ok(html.includes('-empty'), 'Missing empty state element');
    });

    it('should not have option value="lines" in contribution-mode select', () => {
      const selectMatch = html.match(
        /<select[^>]*id="contribution-mode"[^>]*>([\s\S]*?)<\/select>/
      );
      assert.ok(selectMatch, 'contribution-mode select should exist');
      const inner = selectMatch[1];
      assert.ok(!inner.includes('lines'), 'should not contain "lines" option');
      assert.ok(inner.includes('value="author"'), 'should have author option');
      assert.ok(inner.includes('value="commits"'), 'should have commits option');
      const opts = inner.match(/<option/g);
      assert.strictEqual(opts?.length, 2, 'expected exactly 2 options');
    });

    it('should have export overlay spinner only (no tab loading spinners)', () => {
      const loadingEls = html.match(/class="spinner"/g);
      assert.ok(loadingEls, 'No .spinner elements found');
      assert.strictEqual(
        loadingEls.length,
        1,
        `Expected exactly 1 spinner (export overlay), got ${loadingEls.length}`
      );
    });

    it('should have export overlay with spinner and Generating PDF text', () => {
      const overlayMatch = html.match(/<div[^>]*id="export-overlay"[^>]*>([\s\S]*?)<\/div>/);
      assert.ok(overlayMatch, 'export-overlay div must exist');
      const inner = overlayMatch[1];
      assert.ok(/class="spinner"/.test(inner), 'spinner inside overlay');
      assert.ok(inner.includes('Generating PDF'), 'Generating PDF text inside overlay');
    });

    it('should have sortable table headers with sort-indicator SVGs', () => {
      const ths = html.match(/sortable-th/g);
      assert.ok(ths, 'No sortable-th elements found');
      assert.ok(ths.length >= 6, `Expected at least 6 sortable columns, got ${ths.length}`);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  4. dashboard.js — STATEFUL FUNCTION TESTS
// ═══════════════════════════════════════════════════════════════════════════
//
// setTimeFilter and getFilteredData depend on `state`, `document`, `window`,
// and sibling functions. We extract them via brace-counting and run them in
// a vm sandbox with stubs for all dependencies.

describe('Dashboard — dashboard.js (stateful functions)', () => {
  describe('setTimeFilter', () => {
    it('should not return early when filter is "custom" even if already in custom mode', () => {
      const renderCalled = { value: false };
      const sandbox = {
        setTimeout: (fn) => fn(),
        state: {
          timeFilter: 'custom',
          customStartDate: '2024-01-01',
          customEndDate: '2024-01-31'
        },
        window: {
          location: { href: 'http://localhost:3000/' },
          history: { replaceState: () => {} }
        },
        document: {
          querySelectorAll: () => [],
          getElementById: () => null
        },
        renderCurrentTab: () => {
          renderCalled.value = true;
        }
      };
      const fn = loadFn('setTimeFilter', sandbox);

      fn('custom');

      assert.strictEqual(sandbox.state.timeFilter, 'custom');
      assert.ok(renderCalled.value, 'renderCurrentTab should have been called');
    });

    it('should return early when filter matches and is not custom', () => {
      const renderCalled = { value: false };
      const sandbox = {
        state: { timeFilter: 'last3months' },
        window: {
          location: { href: 'http://localhost:3000/' },
          history: { replaceState: () => {} }
        },
        document: {
          querySelectorAll: () => [],
          getElementById: () => null
        },
        renderCurrentTab: () => {
          renderCalled.value = true;
        }
      };
      const fn = loadFn('setTimeFilter', sandbox);

      fn('last3months');

      assert.strictEqual(sandbox.state.timeFilter, 'last3months');
      assert.strictEqual(renderCalled.value, false, 'renderCurrentTab should NOT have been called');
    });

    it('should not return early when switching to custom from another filter', () => {
      const renderCalled = { value: false };
      const sandbox = {
        setTimeout: (fn) => fn(),
        state: { timeFilter: 'last3months' },
        window: {
          location: { href: 'http://localhost:3000/' },
          history: { replaceState: () => {} }
        },
        document: {
          querySelectorAll: () => [],
          getElementById: () => null
        },
        renderCurrentTab: () => {
          renderCalled.value = true;
        }
      };
      const fn = loadFn('setTimeFilter', sandbox);

      fn('custom');

      assert.strictEqual(sandbox.state.timeFilter, 'custom');
      assert.ok(renderCalled.value, 'renderCurrentTab should have been called');
    });

    it('should return early when switching to the same non-custom filter', () => {
      const renderCalled = { value: false };
      const sandbox = {
        state: { timeFilter: 'allTime' },
        window: {
          location: { href: 'http://localhost:3000/' },
          history: { replaceState: () => {} }
        },
        document: {
          querySelectorAll: () => [],
          getElementById: () => null
        },
        renderCurrentTab: () => {
          renderCalled.value = true;
        }
      };
      const fn = loadFn('setTimeFilter', sandbox);

      fn('allTime');

      assert.strictEqual(sandbox.state.timeFilter, 'allTime');
      assert.strictEqual(renderCalled.value, false, 'renderCurrentTab should NOT have been called');
    });
  });

  describe('getFilteredData', () => {
    it('should use computeFilteredActivity result as activity', () => {
      const markerActivity = { byDayOfWeek: [], byHour: [], topFiles: [], marker: true };
      const sandbox = {
        state: {
          data: {
            contributions: [{ date: '2024-01-01', count: 1, authorDetails: [] }],
            frequency: [{ date: '2024-01-01', additions: 10, deletions: 2 }],
            contributors: [],
            activity: { byHour: [], topFiles: [] }
          },
          timeFilter: 'last3months'
        },
        getCutoffDate: () => ({ start: '2024-01-01', end: null }),
        filterByDate: (arr) => arr,
        computeFilteredSummary: (_c, _f) => ({
          totalCommits: 1,
          totalContributors: 1,
          totalAdditions: 10,
          totalDeletions: 2,
          firstCommit: '2024-01-01',
          lastCommit: '2024-01-01',
          activeBranches: 1
        }),
        computeFilteredContributors: () => [],
        computeFilteredActivity: () => markerActivity
      };
      const fn = loadFn('getFilteredData', sandbox);

      const result = fn();

      assert.ok(result, 'getFilteredData should return an object');
      assert.strictEqual(
        result.activity,
        markerActivity,
        'activity should be the result of computeFilteredActivity'
      );
    });

    it('should call computeFilteredActivity with filtered contributions', () => {
      const callArgs = { contributions: null };
      const sandbox = {
        state: {
          data: {
            contributions: [{ date: '2024-01-01', count: 1, authorDetails: [] }],
            frequency: [],
            contributors: [],
            activity: { byHour: [{ hour: 0, count: 5 }], topFiles: [] }
          },
          timeFilter: 'custom'
        },
        getCutoffDate: () => ({ start: '2024-01-01', end: '2024-01-31' }),
        filterByDate: (arr) => arr,
        computeFilteredSummary: () => ({}),
        computeFilteredContributors: () => [],
        computeFilteredActivity: (c) => {
          callArgs.contributions = c;
          return { byDayOfWeek: [] };
        }
      };
      const fn = loadFn('getFilteredData', sandbox);

      fn();

      assert.strictEqual(
        callArgs.contributions,
        sandbox.state.data.contributions,
        'computeFilteredActivity should receive filtered contributions'
      );
    });

    it('should return null when state.data is null', () => {
      const sandbox = {
        state: { data: null, timeFilter: 'allTime' },
        getCutoffDate: () => null
      };
      const fn = loadFn('getFilteredData', sandbox);

      const result = fn();

      assert.strictEqual(result, null);
    });
  });

  describe('buildOptions', () => {
    let fn;

    before(() => {
      const sandbox = {
        window: {
          CHART_DEFAULTS: {
            scales: {
              x: { ticks: { color: '#666' }, grid: { color: '#ddd' } },
              y: { ticks: { color: '#666' }, grid: { color: '#ddd' } }
            },
            plugins: {
              legend: { display: true, position: 'bottom' }
            }
          },
          getScaleDefaults: () => ({
            x: { ticks: { color: '#333' }, grid: { color: '#eee' } },
            y: { ticks: { color: '#333' }, grid: { color: '#eee' } }
          }),
          getTextColor: () => '#ffffff'
        }
      };
      fn = loadFn('buildOptions', sandbox);
    });

    it('should return a copy of CHART_DEFAULTS when no override given', () => {
      const result = fn(undefined);

      // scales.x merged from theme (theme value '#333' overrides DEFAULTS '#666')
      assert.strictEqual(result.scales.x.ticks.color, '#333');
      assert.strictEqual(result.scales.x.grid.color, '#eee');

      // scales.y merged from theme
      assert.strictEqual(result.scales.y.ticks.color, '#333');
      assert.strictEqual(result.scales.y.grid.color, '#eee');

      // plugins carried through from DEFAULTS
      assert.strictEqual(result.plugins.legend.display, true);
      assert.strictEqual(result.plugins.legend.position, 'bottom');

      // legend labels color injected from getTextColor()
      assert.strictEqual(result.plugins.legend.labels.color, '#ffffff');
    });

    it('should deep-merge override.scales over theme defaults', () => {
      const result = fn({
        scales: { x: { ticks: { color: '#ff0000' } } }
      });

      // override wins for ticks.color
      assert.strictEqual(result.scales.x.ticks.color, '#ff0000');
      // theme properties not overridden still present
      assert.strictEqual(result.scales.x.grid.color, '#eee');
      // y still gets full theme merge (no override for y)
      assert.strictEqual(result.scales.y.ticks.color, '#333');
    });

    it('should let override.plugins win over DEFAULTS.plugins', () => {
      const result = fn({
        plugins: { legend: { display: false } }
      });

      assert.strictEqual(result.plugins.legend.display, false);
    });

    it('should preserve existing legend.labels.color when override sets it', () => {
      const result = fn({
        plugins: { legend: { labels: { color: '#123456' } } }
      });

      // explicit color from override — not overwritten by getTextColor()
      assert.strictEqual(result.plugins.legend.labels.color, '#123456');
    });

    it('should handle null/undefined override gracefully', () => {
      const nullResult = fn(null);
      const undefinedResult = fn(undefined);

      // null produces same merged result as undefined
      assert.strictEqual(nullResult.scales.x.ticks.color, '#333');
      assert.strictEqual(nullResult.scales.y.ticks.color, '#333');
      assert.strictEqual(nullResult.plugins.legend.labels.color, '#ffffff');

      // undefined path also correct
      assert.strictEqual(undefinedResult.scales.x.ticks.color, '#333');
      assert.strictEqual(undefinedResult.scales.y.ticks.color, '#333');
      assert.strictEqual(undefinedResult.plugins.legend.labels.color, '#ffffff');
    });
  });

  describe('setupDateRangeListeners', () => {
    function createMockInput(id, initialValue = '') {
      const handlers = {};
      return {
        id,
        value: initialValue,
        addEventListener(type, handler) {
          handlers[type] = handler;
        },
        triggerInput(newValue) {
          this.value = newValue;
          if (handlers.input) handlers.input();
        }
      };
    }

    it('should early-return on partial date in start input, setting customStartDate to null', () => {
      const setTimeFilterCalled = { count: 0 };
      const mockStart = createMockInput('date-start');
      const mockEnd = createMockInput('date-end');

      const sandbox = {
        state: {
          customStartDate: '2025-06-01',
          customEndDate: '2025-06-30',
          data: { summary: { firstCommit: '2024-01-01' } },
          timeFilter: 'custom'
        },
        document: {
          getElementById(id) {
            if (id === 'date-start') return mockStart;
            if (id === 'date-end') return mockEnd;
            return null;
          }
        },
        getTodayLocal: () => '2025-06-15',
        clampDate,
        setTimeFilter(filter) {
          setTimeFilterCalled.count++;
          sandbox.state.timeFilter = filter;
        },
        renderCurrentTab: () => {}
      };

      const fn = loadFn('setupDateRangeListeners', sandbox);
      fn();

      mockStart.triggerInput('202');

      assert.strictEqual(sandbox.state.customStartDate, null);
      assert.strictEqual(setTimeFilterCalled.count, 0);
    });

    it('should early-return on partial date in start input when customStartDate is already null', () => {
      const setTimeFilterCalled = { count: 0 };
      const mockStart = createMockInput('date-start');
      const mockEnd = createMockInput('date-end');

      const sandbox = {
        state: {
          customStartDate: null,
          customEndDate: '2025-06-30',
          data: { summary: { firstCommit: '2024-01-01' } },
          timeFilter: 'custom'
        },
        document: {
          getElementById(id) {
            if (id === 'date-start') return mockStart;
            if (id === 'date-end') return mockEnd;
            return null;
          }
        },
        getTodayLocal: () => '2025-06-15',
        clampDate,
        setTimeFilter(filter) {
          setTimeFilterCalled.count++;
          sandbox.state.timeFilter = filter;
        },
        renderCurrentTab: () => {}
      };

      const fn = loadFn('setupDateRangeListeners', sandbox);
      fn();

      mockStart.triggerInput('2025-');

      assert.strictEqual(sandbox.state.customStartDate, null);
      assert.strictEqual(setTimeFilterCalled.count, 0);
    });

    it('should process full date in start input and call setTimeFilter', () => {
      const setTimeFilterCalled = { count: 0 };
      const mockStart = createMockInput('date-start');
      const mockEnd = createMockInput('date-end');

      const sandbox = {
        state: {
          customStartDate: null,
          customEndDate: '2025-06-30',
          data: { summary: { firstCommit: '2024-01-01' } },
          timeFilter: 'custom'
        },
        document: {
          getElementById(id) {
            if (id === 'date-start') return mockStart;
            if (id === 'date-end') return mockEnd;
            return null;
          }
        },
        getTodayLocal: () => '2025-06-15',
        clampDate,
        setTimeFilter(filter) {
          setTimeFilterCalled.count++;
          sandbox.state.timeFilter = filter;
        },
        renderCurrentTab: () => {}
      };

      const fn = loadFn('setupDateRangeListeners', sandbox);
      fn();

      mockStart.triggerInput('2025-06-01');

      assert.strictEqual(sandbox.state.customStartDate, '2025-06-01');
      assert.strictEqual(setTimeFilterCalled.count, 1);
    });

    it('should early-return on partial date in end input', () => {
      const setTimeFilterCalled = { count: 0 };
      const mockStart = createMockInput('date-start', '2025-06-01');
      const mockEnd = createMockInput('date-end');

      const sandbox = {
        state: {
          customStartDate: '2025-06-01',
          customEndDate: '2025-06-30',
          data: { summary: { firstCommit: '2024-01-01' } },
          timeFilter: 'custom'
        },
        document: {
          getElementById(id) {
            if (id === 'date-start') return mockStart;
            if (id === 'date-end') return mockEnd;
            return null;
          }
        },
        getTodayLocal: () => '2025-06-15',
        clampDate,
        setTimeFilter(filter) {
          setTimeFilterCalled.count++;
          sandbox.state.timeFilter = filter;
        },
        renderCurrentTab: () => {}
      };

      const fn = loadFn('setupDateRangeListeners', sandbox);
      fn();

      mockEnd.triggerInput('2025-');

      assert.strictEqual(sandbox.state.customEndDate, null);
      assert.strictEqual(setTimeFilterCalled.count, 0);
    });

    it('should process full date in end input and call setTimeFilter', () => {
      const setTimeFilterCalled = { count: 0 };
      const mockStart = createMockInput('date-start', '2025-06-01');
      const mockEnd = createMockInput('date-end');

      const sandbox = {
        state: {
          customStartDate: '2025-06-01',
          customEndDate: null,
          data: { summary: { firstCommit: '2024-01-01' } },
          timeFilter: 'custom'
        },
        document: {
          getElementById(id) {
            if (id === 'date-start') return mockStart;
            if (id === 'date-end') return mockEnd;
            return null;
          }
        },
        getTodayLocal: () => '2025-06-15',
        clampDate,
        setTimeFilter(filter) {
          setTimeFilterCalled.count++;
          sandbox.state.timeFilter = filter;
        },
        renderCurrentTab: () => {}
      };

      const fn = loadFn('setupDateRangeListeners', sandbox);
      fn();

      mockEnd.triggerInput('2025-06-15');

      assert.strictEqual(sandbox.state.customEndDate, '2025-06-15');
      assert.strictEqual(setTimeFilterCalled.count, 1);
    });

    it('should clamp end date when start date exceeds existing end date', () => {
      const setTimeFilterCalled = { count: 0 };
      const mockStart = createMockInput('date-start');
      const mockEnd = createMockInput('date-end', '2025-06-01');

      const sandbox = {
        state: {
          customStartDate: null,
          customEndDate: '2025-06-01',
          data: { summary: { firstCommit: '2024-01-01' } },
          timeFilter: 'custom'
        },
        document: {
          getElementById(id) {
            if (id === 'date-start') return mockStart;
            if (id === 'date-end') return mockEnd;
            return null;
          }
        },
        getTodayLocal: () => '2025-06-15',
        clampDate,
        setTimeFilter(filter) {
          setTimeFilterCalled.count++;
          sandbox.state.timeFilter = filter;
        },
        renderCurrentTab: () => {}
      };

      const fn = loadFn('setupDateRangeListeners', sandbox);
      fn();

      mockStart.triggerInput('2025-06-15');

      assert.strictEqual(sandbox.state.customStartDate, '2025-06-15');
      assert.strictEqual(sandbox.state.customEndDate, '2025-06-15');
      assert.strictEqual(setTimeFilterCalled.count, 1);
      assert.strictEqual(mockEnd.value, '2025-06-15');
    });

    it('should not clamp end date when start date is within valid range', () => {
      const setTimeFilterCalled = { count: 0 };
      const mockStart = createMockInput('date-start');
      const mockEnd = createMockInput('date-end', '2025-06-30');

      const sandbox = {
        state: {
          customStartDate: null,
          customEndDate: '2025-06-30',
          data: { summary: { firstCommit: '2024-01-01' } },
          timeFilter: 'custom'
        },
        document: {
          getElementById(id) {
            if (id === 'date-start') return mockStart;
            if (id === 'date-end') return mockEnd;
            return null;
          }
        },
        getTodayLocal: () => '2025-06-15',
        clampDate,
        setTimeFilter(filter) {
          setTimeFilterCalled.count++;
          sandbox.state.timeFilter = filter;
        },
        renderCurrentTab: () => {}
      };

      const fn = loadFn('setupDateRangeListeners', sandbox);
      fn();

      mockStart.triggerInput('2025-06-01');

      assert.strictEqual(sandbox.state.customStartDate, '2025-06-01');
      assert.strictEqual(sandbox.state.customEndDate, '2025-06-30');
      assert.strictEqual(setTimeFilterCalled.count, 1);
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
        defaults: { font: {} },
        register: () => {},
        BarController: {},
        LineController: {},
        LineElement: {},
        BarElement: {},
        PointElement: {},
        CategoryScale: {},
        LinearScale: {},
        Filler: {}
      },
      window: {},
      console: { error: () => {} },
      getComputedStyle: () => ({
        getPropertyValue: () => ''
      }),
      document: { documentElement: {} }
    });

    vm.runInContext(read('chart-config.js'), sandbox);
  });

  describe('COLORS', () => {
    it('should be defined on window', () => {
      assert.ok(sandbox.window.COLORS, 'window.COLORS is undefined');
    });

    it('should have all 8 expected color keys', () => {
      const c = sandbox.window.COLORS;
      assert.strictEqual(typeof c.blue, 'string');
      assert.strictEqual(typeof c.green, 'string');
      assert.strictEqual(typeof c.amber, 'string');
      assert.strictEqual(typeof c.red, 'string');
      assert.strictEqual(typeof c.purple, 'string');
      assert.strictEqual(typeof c.orange, 'string');
      assert.strictEqual(typeof c.cyan, 'string');
      assert.strictEqual(typeof c.pink, 'string');
    });

    it('should all be valid 6-digit hex colors', () => {
      const hex6 = /^#[0-9a-fA-F]{6}$/;
      for (const [key, val] of Object.entries(sandbox.window.COLORS)) {
        assert.match(val, hex6, `COLORS.${key} is not a valid hex color: "${val}"`);
      }
    });
  });

  describe('COLOR_LIST', () => {
    it('should be an array of 8 hex colors', () => {
      const list = sandbox.window.COLOR_LIST;
      assert.ok(Array.isArray(list), 'COLOR_LIST is not an array');
      assert.strictEqual(list.length, 8);
      for (const color of list) {
        assert.match(color, /^#[0-9a-fA-F]{6}$/);
      }
    });

    it('should have the same colors as COLORS in the same order', () => {
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
      assert.ok(d.plugins.legend, 'Missing legend config');
      assert.ok(d.plugins.tooltip, 'Missing tooltip config');
      assert.strictEqual(d.plugins.legend.position, 'bottom');
      assert.strictEqual(d.plugins.tooltip.mode, 'index');
      assert.strictEqual(d.plugins.tooltip.intersect, false);
    });

    it('should have scale defaults (x + y)', () => {
      const d = sandbox.window.CHART_DEFAULTS;
      assert.ok(d.scales, 'Missing scales config');
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
        console: { error: () => {} }
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
// The pure functions are exported from the ES module and imported directly.
// No DOM stubs needed.
//
// Note: escapeHtml (also defined in dashboard.js) depends on `document`
// and can only be verified in a browser or with a full DOM polyfill like
// jsdom.  This test suite skips it for that reason.
//
// Note: a `truncateText` function was mentioned in the spec but does NOT
// exist in the actual dashboard.js source — it is therefore not tested.

describe('Dashboard — dashboard.js (pure functions)', () => {
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

    it('should return em-dash for Number.NaN', () => {
      assert.strictEqual(formatNumber(Number.NaN), '\u2014');
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
      { date: '2024-12-31', val: 3 }
    ];

    it('should return the same array when bounds is null', () => {
      const result = filterByDate(data, null);
      assert.strictEqual(result, data); // same reference
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
      const d = [{ created: '2023-01-01' }, { created: '2024-06-01' }];
      const result = filterByDate(d, { start: '2024-01-01', end: null }, 'created');
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].created, '2024-06-01');
    });

    it('should default to "date" field when field is not supplied', () => {
      const d = [{ date: '2023-01-01' }, { date: '2024-06-01' }];
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
            { author: 'Alice', email: 'alice@personal.com', count: 1, additions: 10, deletions: 2 }
          ]
        }
      ];

      const allContributors = [
        {
          name: 'Alice',
          email: 'alice@work.com',
          totalCommits: 2,
          additions: 20,
          deletions: 5,
          firstCommit: '2025-01-15T10:00:00Z',
          lastCommit: '2025-01-15T14:00:00Z'
        },
        {
          name: 'Alice',
          email: 'alice@personal.com',
          totalCommits: 1,
          additions: 10,
          deletions: 2,
          firstCommit: '2025-01-15T16:00:00Z',
          lastCommit: '2025-01-15T16:00:00Z'
        }
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
            { author: 'User', email: 'email2@test.com', count: 1, additions: 10, deletions: 2 }
          ]
        }
      ];

      const allContributors = [
        {
          name: 'User',
          email: 'email1@test.com',
          totalCommits: 1,
          additions: 5,
          deletions: 1,
          firstCommit: '2025-01-15',
          lastCommit: '2025-01-15'
        },
        {
          name: 'User',
          email: 'email2@test.com',
          totalCommits: 1,
          additions: 10,
          deletions: 2,
          firstCommit: '2025-01-15',
          lastCommit: '2025-01-15'
        }
      ];

      const result = computeFilteredContributors(contributions, allContributors);

      // Two separate entries — email is the key, not author name
      assert.strictEqual(result.length, 2);
      const emails = result.map((c) => c.email).sort((a, b) => a.localeCompare(b));
      assert.deepStrictEqual(emails, ['email1@test.com', 'email2@test.com']);
    });
  });

  // ── computeFilteredActivity ───────────────────────────────────────────────

  describe('computeFilteredActivity', () => {
    it('should recompute byDayOfWeek from filtered contributions', () => {
      // 2024-01-01 = Monday, 2024-01-02 = Tuesday, 2024-01-03 = Wednesday
      const contributions = [
        { date: '2024-01-01', count: 3 },
        { date: '2024-01-02', count: 5 },
        { date: '2024-01-03', count: 2 }
      ];

      const result = computeFilteredActivity(contributions);

      assert.strictEqual(result.byDayOfWeek.length, 7);
      assert.strictEqual(result.byDayOfWeek[0].day, 'Mon');
      assert.strictEqual(result.byDayOfWeek[0].count, 3);
      assert.strictEqual(result.byDayOfWeek[1].day, 'Tue');
      assert.strictEqual(result.byDayOfWeek[1].count, 5);
      assert.strictEqual(result.byDayOfWeek[2].day, 'Wed');
      assert.strictEqual(result.byDayOfWeek[2].count, 2);
      assert.strictEqual(result.byDayOfWeek[3].count, 0);
      assert.strictEqual(result.byDayOfWeek[4].count, 0);
      assert.strictEqual(result.byDayOfWeek[5].count, 0);
      assert.strictEqual(result.byDayOfWeek[6].count, 0);
    });

    it('should recompute byHour from per-day contribution data', () => {
      const contributions = [
        { date: '2024-01-01', count: 2, byHour: make24({ 0: 1, 9: 1 }) },
        { date: '2024-01-02', count: 3, byHour: make24({ 9: 2, 14: 1 }) }
      ];

      const result = computeFilteredActivity(contributions);

      assert.strictEqual(result.byHour.length, 24);
      assert.strictEqual(result.byHour[0].count, 1);
      assert.strictEqual(result.byHour[9].count, 3);
      assert.strictEqual(result.byHour[12].count, 0);
      assert.strictEqual(result.byHour[14].count, 1);
    });

    it('should recompute topFiles from per-day contribution data', () => {
      const contributions = [
        {
          date: '2024-01-01',
          count: 1,
          topFiles: [
            { path: 'src/a.js', changes: 3 },
            { path: 'src/b.js', changes: 1 }
          ]
        },
        {
          date: '2024-01-02',
          count: 2,
          topFiles: [
            { path: 'src/a.js', changes: 2 },
            { path: 'src/c.js', changes: 4 }
          ]
        }
      ];

      const result = computeFilteredActivity(contributions);

      assert.strictEqual(result.topFiles.length, 3);
      assert.strictEqual(result.topFiles[0].path, 'src/a.js');
      assert.strictEqual(result.topFiles[0].changes, 5);
      assert.strictEqual(result.topFiles[1].path, 'src/c.js');
      assert.strictEqual(result.topFiles[1].changes, 4);
      assert.strictEqual(result.topFiles[2].path, 'src/b.js');
      assert.strictEqual(result.topFiles[2].changes, 1);
    });

    it('should return empty byHour and topFiles when contributions lack per-day data', () => {
      const contributions = [{ date: '2024-01-01', count: 1 }];

      const result = computeFilteredActivity(contributions);

      assert.strictEqual(result.byHour.length, 24);
      result.byHour.forEach(function (h) {
        assert.strictEqual(h.count, 0);
      });
      assert.deepStrictEqual(result.topFiles, []);
    });

    it('should handle empty contributions array', () => {
      const result = computeFilteredActivity([]);

      assert.strictEqual(result.byDayOfWeek.length, 7);
      result.byDayOfWeek.forEach(function (d) {
        assert.strictEqual(d.count, 0);
      });
    });

    it('should handle single contribution', () => {
      const result = computeFilteredActivity([{ date: '2024-01-01', count: 7 }]);

      assert.strictEqual(result.byDayOfWeek[0].count, 7);
      assert.strictEqual(result.byDayOfWeek[0].day, 'Mon');
    });

    it('should map weekend days correctly', () => {
      // 2024-01-06 = Saturday (getUTCDay() = 6 → (6+6)%7 = 5 = "Sat")
      // 2024-01-07 = Sunday   (getUTCDay() = 0 → (0+6)%7 = 6 = "Sun")
      const contributions = [
        { date: '2024-01-06', count: 10 }, // Saturday
        { date: '2024-01-07', count: 20 } // Sunday
      ];

      const result = computeFilteredActivity(contributions);

      assert.strictEqual(result.byDayOfWeek[5].day, 'Sat');
      assert.strictEqual(result.byDayOfWeek[5].count, 10);
      assert.strictEqual(result.byDayOfWeek[6].day, 'Sun');
      assert.strictEqual(result.byDayOfWeek[6].count, 20);
    });

    it('should handle mixed contributions with and without per-day data', () => {
      const contributions = [
        {
          date: '2024-01-01',
          count: 2,
          byHour: make24({ 9: 3 }),
          topFiles: [{ path: 'src/a.js', changes: 5 }]
        },
        { date: '2024-01-02', count: 1 }
      ];

      const result = computeFilteredActivity(contributions);

      assert.strictEqual(result.byHour[9].count, 3);
      assert.strictEqual(result.topFiles.length, 1);
      assert.strictEqual(result.topFiles[0].path, 'src/a.js');
      assert.strictEqual(result.topFiles[0].changes, 5);
    });
  });

  // ── clampDate ─────────────────────────────────────────────────────────────

  describe('clampDate', () => {
    it('should return min when date is below min', () => {
      assert.strictEqual(clampDate('2020-01-01', '2023-01-01', '2024-12-31'), '2023-01-01');
    });

    it('should return max when date is above max', () => {
      assert.strictEqual(clampDate('2025-01-01', '2023-01-01', '2024-12-31'), '2024-12-31');
    });

    it('should return date unchanged when within range', () => {
      assert.strictEqual(clampDate('2024-06-15', '2024-01-01', '2024-12-31'), '2024-06-15');
    });

    it('should return falsy/null/empty date unchanged', () => {
      assert.strictEqual(clampDate(null, '2024-01-01', '2024-12-31'), null);
      assert.strictEqual(clampDate(undefined, '2024-01-01', '2024-12-31'), undefined);
      assert.strictEqual(clampDate('', '2024-01-01', '2024-12-31'), '');
    });

    it('should work with only min constraint (no max)', () => {
      assert.strictEqual(clampDate('2020-01-01', '2023-01-01', null), '2023-01-01');
      assert.strictEqual(clampDate('2024-06-15', '2023-01-01', null), '2024-06-15');
    });

    it('should work with only max constraint (no min)', () => {
      assert.strictEqual(clampDate('2025-01-01', null, '2024-12-31'), '2024-12-31');
      assert.strictEqual(clampDate('2024-06-15', null, '2024-12-31'), '2024-06-15');
    });

    it('should return date when both min and max are null', () => {
      assert.strictEqual(clampDate('2024-06-15', null, null), '2024-06-15');
    });

    it('should treat equal boundaries correctly', () => {
      assert.strictEqual(clampDate('2024-06-15', '2024-06-15', '2024-06-15'), '2024-06-15');
      assert.strictEqual(clampDate('2024-06-14', '2024-06-15', '2024-06-15'), '2024-06-15');
      assert.strictEqual(clampDate('2024-06-16', '2024-06-15', '2024-06-15'), '2024-06-15');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  UI INTEGRITY TESTS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('dashboard.js — UI integrity', () => {
    let src;

    before(() => {
      src = read('dashboard.js');
    });

    it('should not define renderContributionLines anywhere in the source', () => {
      assert.ok(
        !src.includes('renderContributionLines'),
        'renderContributionLines should be removed from dashboard.js'
      );
    });

    it('should have no extractable function named renderContributionLines', () => {
      const fn = extractFunction('renderContributionLines', src);
      assert.strictEqual(fn, null, 'renderContributionLines function should not be extractable');
    });

    it('should use c.name?.trim() || c.email as display fallback for contributor name', () => {
      assert.ok(
        src.includes('c.name?.trim() || c.email'),
        'renderContributorsTable should fall back to email when name is missing'
      );
    });

    it('should build titleText with "Name <email>" when both exist', () => {
      assert.ok(
        src.includes(
          `titleText = c.name?.trim() && c.email ? c.name?.trim() + ' <' + c.email + '>' : c.email`
        ),
        'titleText should use Name <email> format'
      );
    });

    it('should call escapeHtml on the title attribute value', () => {
      assert.ok(src.includes('escapeHtml(titleText)'), 'escapeHtml must be called on titleText');
    });

    it('should call escapeHtml on the display name', () => {
      assert.ok(
        src.includes('escapeHtml(displayName)'),
        'escapeHtml should be used on displayName'
      );
    });

    it('should set document.body.style.overflow to "hidden" during export', () => {
      assert.ok(
        src.includes("document.body.style.overflow = 'hidden'"),
        'must set body overflow to hidden when starting export'
      );
    });

    it('should reference getElementById with "export-overlay"', () => {
      assert.ok(
        src.includes("getElementById('export-overlay')"),
        'must call getElementById with export-overlay'
      );
    });

    it('should call renderOverview inside setupExportPdf', () => {
      const fn = extractFunction('setupExportPdf', src);
      assert.ok(fn, 'setupExportPdf must be defined');
      assert.ok(fn.includes('renderOverview('), 'setupExportPdf must call renderOverview');
    });

    it('should call renderContributors inside setupExportPdf', () => {
      const fn = extractFunction('setupExportPdf', src);
      assert.ok(fn, 'setupExportPdf must be defined');
      assert.ok(fn.includes('renderContributors('), 'setupExportPdf must call renderContributors');
    });

    it('should call renderActivity inside setupExportPdf', () => {
      const fn = extractFunction('setupExportPdf', src);
      assert.ok(fn, 'setupExportPdf must be defined');
      assert.ok(fn.includes('renderActivity('), 'setupExportPdf must call renderActivity');
    });

    it('should call renderCurrentTab in the finally block', () => {
      const fn = extractFunction('setupExportPdf', src);
      assert.ok(fn, 'setupExportPdf must be defined');
      const lastFinallyIndex = fn.lastIndexOf('finally');
      assert.ok(lastFinallyIndex !== -1, 'setupExportPdf must have a finally block');
      const afterFinally = fn.slice(lastFinallyIndex);
      assert.ok(
        afterFinally.includes('renderCurrentTab('),
        'finally block must call renderCurrentTab'
      );
    });
  });

  describe('HTML (index.html) — UI integrity', () => {
    let html;

    before(() => {
      html = read('index.html');
    });

    it('should not contain option value="lines" anywhere', () => {
      assert.ok(
        !html.includes('value="lines"'),
        'index.html should not contain <option value="lines">'
      );
    });

    it('should have contribution-mode select with only author and commits options', () => {
      const selectMatch = html.match(
        /<select[^>]*id="contribution-mode"[^>]*>([\s\S]*?)<\/select>/
      );
      assert.ok(selectMatch, 'contribution-mode select should exist');
      const innerHtml = selectMatch[1];
      const optionMatches = innerHtml.match(/<option/g);
      assert.strictEqual(optionMatches?.length, 2, 'Expected exactly 2 option elements');
      assert.ok(innerHtml.includes('value="author"'), 'Should have author option');
      assert.ok(innerHtml.includes('value="commits"'), 'Should have commits option');
      assert.ok(!innerHtml.includes('lines'), 'Should not contain lines option');
    });

    it('should contain an element with id="export-overlay"', () => {
      assert.ok(/id="export-overlay"/.test(html), 'must contain id="export-overlay"');
    });

    it('should contain a .spinner element inside the export overlay', () => {
      const overlayMatch = html.match(/<div[^>]*id="export-overlay"[^>]*>([\s\S]*?)<\/div>/);
      assert.ok(overlayMatch, 'export-overlay div must exist');
      assert.ok(/class="spinner"/.test(overlayMatch[1]), '.spinner must exist inside overlay');
    });

    it('should contain "Generating PDF…" text inside the export overlay', () => {
      const overlayMatch = html.match(/<div[^>]*id="export-overlay"[^>]*>([\s\S]*?)<\/div>/);
      assert.ok(overlayMatch, 'export-overlay div must exist');
      assert.ok(
        overlayMatch[1].includes('Generating PDF\u2026') ||
          overlayMatch[1].includes('Generating PDF…'),
        'overlay must contain "Generating PDF…" text'
      );
    });
  });

  describe('CSS (style.css) — UI integrity', () => {
    let css;

    before(() => {
      css = read('style.css');
    });

    it('should define text-overflow: ellipsis on .data-table td', () => {
      const tdMatch = css.match(/\.data-table\s+td\s*\{([^}]*)\}/);
      assert.ok(tdMatch, '.data-table td selector must exist');
      assert.ok(tdMatch[1].includes('text-overflow: ellipsis'));
    });

    it('should define max-width on .data-table td', () => {
      const tdMatch = css.match(/\.data-table\s+td\s*\{([^}]*)\}/);
      assert.ok(tdMatch, '.data-table td selector must exist');
      assert.ok(tdMatch[1].includes('max-width'), 'should have max-width for truncation');
    });

    it('should define overflow: hidden on .data-table td', () => {
      const tdMatch = css.match(/\.data-table\s+td\s*\{([^}]*)\}/);
      assert.ok(tdMatch, '.data-table td selector must exist');
      assert.ok(tdMatch[1].includes('overflow: hidden'));
    });

    it('should define .export-overlay with position: fixed', () => {
      const overlayMatch = css.match(/\.export-overlay\s*\{([^}]*)\}/);
      assert.ok(overlayMatch, '.export-overlay selector must exist');
      assert.ok(overlayMatch[1].includes('position: fixed'));
    });

    it('should define .export-overlay with inset: 0', () => {
      const overlayMatch = css.match(/\.export-overlay\s*\{([^}]*)\}/);
      assert.ok(overlayMatch, '.export-overlay selector must exist');
      assert.ok(overlayMatch[1].includes('inset: 0'));
    });

    it('should define .export-overlay.hidden with display: none', () => {
      const hiddenMatch = css.match(/\.export-overlay\.hidden\s*\{([^}]*)\}/);
      assert.ok(hiddenMatch, '.export-overlay.hidden selector must exist');
      assert.ok(hiddenMatch[1].includes('display: none'));
    });
  });
});

/*
  Export PDF functionality tests for Insights dashboard.
  Uses the same VM extraction helpers as dashboard.test.js.
*/

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

// Helper to read source file
function read(file) {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const DASHBOARD_DIR = join(__dirname, '..', 'dashboard');
  return readFileSync(join(DASHBOARD_DIR, file), 'utf-8');
}

// Extract a function's source from dashboard.js by matching its name and brace depth.
function extractFunction(name, src) {
  const re = new RegExp(String.raw`function\s+${name}\s*\([^)]*\)\s*\{`);
  const match = re.exec(src);
  if (!match) return null;
  const start = match.index;
  let i = start;
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

// Load a function from dashboard.js into a VM context with the supplied sandbox.
function loadFn(name, sandbox) {
  const ctx = vm.createContext(sandbox);
  const src = read('dashboard.js');
  const fnSrc = extractFunction(name, src);
  if (!fnSrc) throw new Error(`${name} not found in dashboard.js`);
  return vm.runInContext('(' + fnSrc + ')', ctx);
}

describe('Dashboard — setupExportPdf', () => {
  // Common sandbox pieces that are reused across tests
  function createBaseSandbox() {
    // Mock DOM elements
    const span = { textContent: 'Export PDF' };
    const btnClassSet = new Set();
    const exportBtn = {
      disabled: false,
      classList: {
        add: (c) => btnClassSet.add(c),
        remove: (c) => btnClassSet.delete(c),
      },
      querySelector: (sel) => (sel === 'span' ? span : null),
      addEventListener: function (event, handler) {
        // store handler for manual invocation
        this._handler = handler;
      },
    };

    const headerTitleEl = { textContent: 'Original Header' };
    const metricEl = {};

    // Simple classList implementation using a Set
    const classSet = new Set();
    const classList = {
      add: (c) => classSet.add(c),
      remove: (c) => classSet.delete(c),
      contains: (c) => classSet.has(c),
    };

    const overlayClassSet = new Set();
    const overlayStyle = {};
    const overlay = {
      style: overlayStyle,
      classList: {
        add: (c) => overlayClassSet.add(c),
        remove: (c) => overlayClassSet.delete(c),
        contains: (c) => overlayClassSet.has(c),
      },
    };

    function chartCardEl() {
      return { querySelector: () => null };
    }

    const document = {
      getElementById: (id) => {
        if (id === 'export-pdf') return exportBtn;
        if (id === 'export-overlay') return overlay;
        return null;
      },
      querySelector: (sel) => {
        if (sel === '.header-title') return headerTitleEl;
        if (sel === '.metric-grid') return metricEl;
        return null;
      },
      querySelectorAll: (sel) => {
        if (sel === '#tab-overview .chart-card')
          return [chartCardEl(), chartCardEl(), chartCardEl()];
        if (sel === '#tab-contributors .chart-card, #tab-activity .chart-card')
          return [chartCardEl(), chartCardEl(), chartCardEl()];
        return [];
      },
      title: 'Original Document Title',
      body: { classList, style: {} },
      documentElement: {},
    };

    // Mock window and PDF generation utilities
    const window = {
      html2canvas: async () => ({
        width: 100,
        height: 100,
        toDataURL: () => 'data:image/png;base64,ABCD',
      }),
      NOTO_SANS_MULTILANGUAGE_BASE64: 'mockBase64String',
      jspdf: {
        jsPDF: function () {
          const pdf = {
            internal: { pageSize: { getWidth: () => 210, getHeight: () => 297 } },
            setFontSize: () => {},
            text: () => {},
            addImage: () => {},
            autoTable: function () {
              this.lastAutoTable = { finalY: 50 };
            },
            addPage: () => {},
            save: () => {},
            lastAutoTable: { finalY: 0 },
            addFileToVFS: () => {},
            addFont: () => {},
            setFont: () => {},
          };
          return pdf;
        },
      },
      fetch: async () => ({
        ok: false,
      }),
    };

    // Stub for print detection – should never be called
    let printCalled = false;
    window.print = () => {
      printCalled = true;
    };

    // Flags to verify that rendering callbacks were invoked
    const renderFlags = { overview: false, contributors: false, activity: false, current: false };

    // Mock chart objects with resize spies
    const chartResizeLog = [];
    const chartMocks = {
      'chart-contribution': {
        resize: (_, opts) => chartResizeLog.push({ id: 'chart-contribution', opts }),
      },
      'chart-top-contributors': {
        resize: (_, opts) => chartResizeLog.push({ id: 'chart-top-contributors', opts }),
      },
      'chart-frequency-overview': {
        resize: (_, opts) => chartResizeLog.push({ id: 'chart-frequency-overview', opts }),
      },
    };

    const sandbox = {
      // Global state mimicking the app state
      state: {
        charts: { ...chartMocks },
        data: { summary: { repoName: 'test-repo' } },
        theme: 'light',
      },
      // Dependencies used by setupExportPdf
      getFilteredData: () => ({
        contributions: [{ date: '2024-01-01', count: 1 }],
        contributors: [
          {
            name: 'test-user',
            email: 'test@example.com',
            totalCommits: 5,
            additions: 100,
            deletions: 50,
            firstCommit: '2024-01-01',
            lastCommit: '2024-06-01',
          },
        ],
        activity: { topFiles: [{ path: 'src/index.js', changes: 10 }] },
      }),
      getDateRangeLabel: () => 'Date Range',
      sortContributors: (c) => c,
      formatNumber: (n) => String(n),
      formatDate: (d) => d || '\u2014',
      renderOverview: () => {
        renderFlags.overview = true;
      },
      renderContributors: () => {
        renderFlags.contributors = true;
      },
      renderActivity: () => {
        renderFlags.activity = true;
      },
      renderCurrentTab: () => {
        renderFlags.current = true;
      },
      applyTheme: (theme) => {
        sandbox.state.theme = theme;
      },
      getComputedStyle: () => ({
        getPropertyValue: (name) => {
          if (name === '--bg') return '#0d1117';
          if (name === '--text') return '#e6edf3';
          return '';
        },
      }),
      document,
      window,
      console: { error: () => {} },
      // Make setTimeout resolve immediately to avoid real delays in tests
      setTimeout: (cb, _ms) => {
        cb();
      },
    };

    return {
      sandbox,
      exportBtn,
      span,
      headerTitleEl,
      document,
      classSet,
      renderFlags,
      chartResizeLog,
      getPrintCalled: () => printCalled,
    };
  }

  it('should disable button, update titles, call render functions and clean up after success', async () => {
    const {
      sandbox,
      exportBtn,
      span,
      headerTitleEl,
      document,
      classSet,
      renderFlags,
      chartResizeLog,
      getPrintCalled,
    } = createBaseSandbox();

    const fn = loadFn('setupExportPdf', sandbox);
    // Register the click listener
    fn();

    // Simulate a click on the export button
    await exportBtn._handler();

    // Verify button state restored
    assert.strictEqual(exportBtn.disabled, false, 'Button should be re-enabled');
    assert.strictEqual(span.textContent, 'Export PDF', 'Button text should be restored');

    // Verify document title and header restored
    assert.strictEqual(
      document.title,
      'Original Document Title',
      'document.title should be restored',
    );
    assert.strictEqual(
      headerTitleEl.textContent,
      'Original Header',
      'Header title should be restored',
    );

    // Verify printing class was added then removed
    assert.strictEqual(
      classSet.has('printing'),
      false,
      'printing class should be removed after cleanup',
    );

    // Verify render callbacks were called
    assert.ok(renderFlags.overview, 'renderOverview should be called');
    assert.ok(renderFlags.contributors, 'renderContributors should be called');
    assert.ok(renderFlags.activity, 'renderActivity should be called');
    assert.ok(renderFlags.current, 'renderCurrentTab should be called after cleanup');

    // Verify chart resize was called with duration: 0
    assert.ok(chartResizeLog.length >= 3, 'at least 3 chart resizes should be called');
    for (const entry of chartResizeLog) {
      assert.ok(entry.opts?.duration === 0, 'resize should suppress animations with duration: 0');
    }

    // Ensure window.print was never invoked
    assert.strictEqual(getPrintCalled(), false, 'window.print should not be called');
  });

  it('should still clean up when PDF generation throws an error', async () => {
    const base = createBaseSandbox();
    const {
      sandbox,
      exportBtn,
      span,
      headerTitleEl,
      document,
      classSet,
      renderFlags,
      getPrintCalled,
    } = base;

    // Make html2canvas reject to simulate a failure during PDF generation
    sandbox.window.html2canvas = async () => {
      throw new Error('capture failed');
    };

    const fn = loadFn('setupExportPdf', sandbox);
    fn();

    // Click the button – the promise should resolve despite the internal error
    await exportBtn._handler();

    // After error, the cleanup should still happen
    assert.strictEqual(exportBtn.disabled, false, 'Button should be re-enabled after error');
    assert.strictEqual(
      span.textContent,
      'Export PDF',
      'Button text should be restored after error',
    );
    assert.strictEqual(
      document.title,
      'Original Document Title',
      'document.title should be restored after error',
    );
    assert.strictEqual(
      headerTitleEl.textContent,
      'Original Header',
      'Header title should be restored after error',
    );
    assert.strictEqual(
      classSet.has('printing'),
      false,
      'printing class should be removed after error',
    );
    assert.ok(renderFlags.overview, 'renderOverview should be called even on error');
    assert.ok(renderFlags.contributors, 'renderContributors should be called even on error');
    assert.ok(renderFlags.activity, 'renderActivity should be called even on error');
    assert.ok(renderFlags.current, 'renderCurrentTab should be called after error');
    assert.strictEqual(getPrintCalled(), false, 'window.print should not be called even on error');
  });

  it('should still clean up when jspdf is undefined', async () => {
    const base = createBaseSandbox();
    const {
      sandbox,
      exportBtn,
      span,
      headerTitleEl,
      document,
      classSet,
      renderFlags,
      getPrintCalled,
    } = base;

    // Remove jspdf from the global scope
    sandbox.window.jspdf = undefined;

    const fn = loadFn('setupExportPdf', sandbox);
    fn();

    // Click the button – the promise should resolve despite the missing jspdf
    await exportBtn._handler();

    // Cleanup should still happen
    assert.strictEqual(
      exportBtn.disabled,
      false,
      'Button should be re-enabled when jspdf is missing',
    );
    assert.strictEqual(
      span.textContent,
      'Export PDF',
      'Button text should be restored when jspdf is missing',
    );
    assert.strictEqual(
      document.title,
      'Original Document Title',
      'document.title should be restored when jspdf is missing',
    );
    assert.strictEqual(
      headerTitleEl.textContent,
      'Original Header',
      'Header title should be restored when jspdf is missing',
    );
    assert.strictEqual(
      classSet.has('printing'),
      false,
      'printing class should be removed when jspdf is missing',
    );
    assert.strictEqual(
      renderFlags.overview,
      true,
      'renderOverview should be called even when jspdf is missing',
    );
    assert.ok(renderFlags.current, 'renderCurrentTab should be called when jspdf is missing');
    assert.strictEqual(
      getPrintCalled(),
      false,
      'window.print should not be called when jspdf is missing',
    );
  });

  it('should save the current theme before rendering and restore it after completion (savedTheme)', async () => {
    const base = createBaseSandbox();
    const { sandbox, exportBtn } = base;

    // Start with dark theme to verify savedTheme captures the current value
    sandbox.state.theme = 'dark';

    const fn = loadFn('setupExportPdf', sandbox);
    fn();

    await exportBtn._handler();

    // Theme should be restored to the original dark value after completion
    assert.strictEqual(
      sandbox.state.theme,
      'dark',
      'Theme should be restored to original dark value after PDF generation',
    );
  });

  it('should apply light theme during PDF capture', async () => {
    const base = createBaseSandbox();
    const { sandbox, exportBtn } = base;

    const themeTimeline = [];

    // Track theme changes via applyTheme
    sandbox.applyTheme = (theme) => {
      themeTimeline.push(theme);
      sandbox.state.theme = theme;
    };

    // Start with dark
    sandbox.state.theme = 'dark';

    const fn = loadFn('setupExportPdf', sandbox);
    fn();

    await exportBtn._handler();

    assert.ok(themeTimeline.includes('light'), 'Light theme should be applied during PDF capture');
    assert.strictEqual(
      sandbox.state.theme,
      'dark',
      'Original dark theme should be restored after PDF generation completes',
    );
  });

  it('should restore original theme after successful PDF generation', async () => {
    const base = createBaseSandbox();
    const { sandbox, exportBtn } = base;

    // Start with a non-default theme to make restoration observable
    sandbox.state.theme = 'dark';

    const fn = loadFn('setupExportPdf', sandbox);
    fn();

    await exportBtn._handler();

    assert.strictEqual(
      sandbox.state.theme,
      'dark',
      'Original theme should be restored after successful PDF generation',
    );
  });

  it('should restore original theme even when html2canvas rejects', async () => {
    const base = createBaseSandbox();
    const { sandbox, exportBtn } = base;

    // Start with dark theme
    sandbox.state.theme = 'dark';

    // Make html2canvas reject to simulate a PDF generation failure
    sandbox.window.html2canvas = async () => {
      throw new Error('capture failed');
    };

    const fn = loadFn('setupExportPdf', sandbox);
    fn();

    await exportBtn._handler();

    assert.strictEqual(
      sandbox.state.theme,
      'dark',
      'Theme should be restored to original dark even when html2canvas rejects',
    );
  });

  it('should restore original theme when jspdf is undefined', async () => {
    const base = createBaseSandbox();
    const { sandbox, exportBtn } = base;

    // Start with dark theme
    sandbox.state.theme = 'dark';

    // Remove jspdf from the global scope to trigger early failure
    sandbox.window.jspdf = undefined;

    const fn = loadFn('setupExportPdf', sandbox);
    fn();

    await exportBtn._handler();

    assert.strictEqual(
      sandbox.state.theme,
      'dark',
      'Theme should be restored to original dark even when jspdf is missing',
    );
  });
});

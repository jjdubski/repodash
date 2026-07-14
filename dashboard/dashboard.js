/* ═════════════════════════════════════════════════════════════════════
   Insights Dashboard — Application Logic
   ═════════════════════════════════════════════════════════════════════ */

'use strict';

import {
  formatNumber,
  formatDate,
  clampDate,
  getCutoffDate,
  filterByDate,
  downsampleData,
  computeFilteredSummary,
  computeFilteredContributors,
  computeFilteredActivity,
  sortContributors,
  MAX_CHART_POINTS
} from './filter.js';

// Re-export for backward-compat (Phase 3 — tests still import from dashboard.js)
export {
  formatNumber,
  formatDate,
  clampDate,
  getCutoffDate,
  filterByDate,
  computeFilteredContributors,
  computeFilteredActivity
};

// ── State ───────────────────────────────────────────────────────────
const state = {
  data: null,
  activeTab: 'overview',
  timeFilter: 'last3months',
  theme: 'light',
  charts: {},
  customStartDate: null,
  customEndDate: null,
  contributionMode: 'author',
  topContributorsMode: 'commits',
  contributorsSortBy: 'commits',
  contributorsSortOrder: 'desc',
  contributorsPage: 1,
  contributorsPageSize: 500,
  _filterCacheKey: null,
  _filterCache: null,
  worker: null,
  workerReady: false
};

let _requestId = 0;

// ═════════════════════════════════════════════════════════════════════
//  UTILITIES (UI-specific — NOT in filter.js)
// ═════════════════════════════════════════════════════════════════════

function getTodayLocal() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return year + '-' + month + '-' + day;
}

let _escapeDiv = null;

function escapeHtml(str) {
  if (str == null) return '';
  if (!_escapeDiv) _escapeDiv = document.createElement('div');
  _escapeDiv.textContent = str;
  return _escapeDiv.innerHTML;
}

function debounce(fn, ms) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), ms);
  };
}

function getDateRangeLabel(d) {
  let startLabel, endLabel;
  if (state.timeFilter === 'allTime' && d?.summary) {
    startLabel = formatDate(d.summary.firstCommit);
    endLabel = formatDate(getTodayLocal());
  } else {
    const bounds = getCutoffDate(state.timeFilter, state.customStartDate, state.customEndDate);
    if (bounds) {
      startLabel = bounds.start ? formatDate(bounds.start) : 'Beginning';
      endLabel = bounds.end ? formatDate(bounds.end) : formatDate(getTodayLocal());
    } else {
      startLabel = d?.summary ? formatDate(d.summary.firstCommit) : 'Beginning';
      endLabel = d?.summary ? formatDate(d.summary.lastCommit) : 'Present';
    }
  }
  if (startLabel === endLabel) return startLabel;
  return startLabel + ' \u2014 ' + endLabel;
}

// ═════════════════════════════════════════════════════════════════════
//  CHART MANAGEMENT
// ═════════════════════════════════════════════════════════════════════

function lineChartOptions(frequency) {
  return {
    scales: {
      x: { maxTicksLimit: frequency.length > 90 ? 12 : undefined }
    },
    plugins: {
      legend: {
        position: 'bottom',
        labels: { boxWidth: 12, padding: 12, usePointStyle: true }
      }
    },
    interaction: { mode: 'nearest', axis: 'x', intersect: false }
  };
}

function buildOptions(override) {
  const D = globalThis.window.CHART_DEFAULTS;
  const theme = globalThis.window.getScaleDefaults();
  const text = globalThis.window.getTextColor();

  const opts = {};
  let key;
  for (key in D) {
    if (Object.hasOwn(D, key)) opts[key] = D[key];
  }

  if (override) {
    for (key in override) {
      if (Object.hasOwn(override, key)) opts[key] = override[key];
    }
  }

  const srcScales = override?.scales || {};
  opts.scales = opts.scales || {};
  opts.scales.x = { ...D.scales.x, ...theme.x, ...srcScales.x };
  opts.scales.y = { ...D.scales.y, ...theme.y, ...srcScales.y };

  if (override?.plugins) {
    opts.plugins = { ...D.plugins, ...override.plugins };
  } else {
    opts.plugins = { ...D.plugins };
  }

  if (opts.plugins.legend && !opts.plugins.legend.labels) {
    opts.plugins.legend.labels = { color: text };
  } else if (opts.plugins.legend?.labels && !opts.plugins.legend.labels.color) {
    opts.plugins.legend.labels.color = text;
  }

  return opts;
}

function destroyChart(id) {
  if (state.charts[id]) {
    state.charts[id].destroy();
    delete state.charts[id];
  }
}

function createChart(id, type, data, optionsOverride) {
  destroyChart(id);
  const canvas = document.getElementById(id);
  if (!canvas) return null;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  state.charts[id] = new globalThis.window.Chart(ctx, {
    type: type,
    data: data,
    options: buildOptions(optionsOverride)
  });
  return state.charts[id];
}

function updateAllChartColors() {
  const theme = globalThis.window.getScaleDefaults();
  const text = globalThis.window.getTextColor();
  for (const id of Object.keys(state.charts)) {
    const chart = state.charts[id];
    if (!chart) continue;

    const scales = chart.scales || {};
    if (scales.x) {
      scales.x.options.ticks.color = theme.x.ticks.color;
    }
    if (scales.y) {
      scales.y.options.ticks.color = theme.y.ticks.color;
      scales.y.options.grid.color = theme.y.grid.color;
    }

    const legend = chart.legend;
    if (legend?.options?.labels) {
      legend.options.labels.color = text;
    }

    chart.update();
  }
}

// ── rAF Chart Scheduler ──────────────────────────────────────────────

const _chartQueue = [];
let _chartScheduled = false;

function _clearChartQueue() {
  _chartQueue.length = 0;
  _chartScheduled = false;
}

function scheduleChart(id, type, data, options) {
  return new Promise(function (resolve) {
    _chartQueue.push({ id, type, data, options, resolve });
    if (!_chartScheduled) {
      _chartScheduled = true;
      requestAnimationFrame(_processChartQueue);
    }
  });
}

function _processChartQueue() {
  const item = _chartQueue.shift();
  if (!item) {
    _chartScheduled = false;
    return;
  }

  createOrUpdateChart(item.id, item.type, item.data, item.options);
  item.resolve();

  if (_chartQueue.length > 0) {
    requestAnimationFrame(_processChartQueue);
  } else {
    _chartScheduled = false;
  }
}

function createOrUpdateChart(id, type, data, options) {
  const existing = state.charts[id];
  if (!existing) {
    return createChart(id, type, data, options);
  }

  const prevAxis = existing.options?.indexAxis || 'x';
  const newAxis = options?.indexAxis || 'x';
  const indexAxisChanged = prevAxis !== newAxis;

  if (
    !indexAxisChanged &&
    existing.config.type === type &&
    existing.data.datasets.length === data.datasets.length
  ) {
    existing.data.labels = data.labels;
    data.datasets.forEach(function (ds, i) {
      const target = existing.data.datasets[i];
      if (!target) return;
      Object.keys(ds).forEach(function (k) {
        target[k] = ds[k];
      });
    });
    existing.options = buildOptions(options);
    existing.update('none');
    return existing;
  }

  return createChart(id, type, data, options);
}

// ── Empty chart skeletons ────────────────────────────────────────────

function initEmptyChart(id, type) {
  destroyChart(id);
  const canvas = document.getElementById(id);
  if (!canvas) return;
  const dataset =
    type === 'line'
      ? {
          data: [0],
          borderColor: 'transparent',
          backgroundColor: 'transparent',
          fill: false
        }
      : { data: [0], backgroundColor: 'transparent', borderColor: 'transparent' };
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  state.charts[id] = new globalThis.window.Chart(ctx, {
    type: type,
    data: { labels: [''], datasets: [dataset] },
    options: buildOptions({
      scales: { y: { beginAtZero: true } },
      plugins: { legend: { display: false } }
    })
  });
}

function initEmptyCharts(tab) {
  clearStates(tab);
  if (tab === 'overview') {
    initEmptyChart('chart-contribution', 'bar');
    initEmptyChart('chart-top-contributors', 'bar');
    initEmptyChart('chart-frequency-overview', 'line');
  } else if (tab === 'contributors') {
    initEmptyChart('chart-contributor-distribution', 'bar');
    const tbody = document.querySelector('#contributors-table tbody');
    if (tbody && !tbody.children.length) {
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td>\u2014</td><td class="num-col">\u2014</td><td class="num-col">\u2014</td><td class="num-col">\u2014</td><td>\u2014</td><td>\u2014</td>';
      tbody.appendChild(tr);
    }
  } else if (tab === 'activity') {
    initEmptyChart('chart-dayofweek', 'bar');
    initEmptyChart('chart-hour', 'bar');
  }
}

// ═════════════════════════════════════════════════════════════════════
//  DATA LOADING & STATE MESSAGES
// ═════════════════════════════════════════════════════════════════════

const TABS = ['overview', 'contributors', 'activity'];

function showElem(id) {
  const e = document.getElementById(id);
  if (e) e.classList.remove('hidden');
}
function hideElem(id) {
  const e = document.getElementById(id);
  if (e) e.classList.add('hidden');
}

function showContent(tab) {
  const section = document.getElementById('tab-' + tab);
  if (section) section.classList.remove('tab-loading');
}

function showError(tab, msg) {
  const el = document.getElementById(tab + '-error');
  if (el) {
    el.textContent = msg;
    showElem(tab + '-error');
  }
}
function showEmpty(tab) {
  showElem(tab + '-empty');
}

function clearStates(tab) {
  hideElem(tab + '-error');
  hideElem(tab + '-empty');
  showContent(tab);
}

// ── Web Worker ───────────────────────────────────────────────────────

function initWorker() {
  try {
    state.worker = new Worker('worker.js', { type: 'module' });
    state.workerReady = false;

    state.worker.addEventListener('message', function (e) {
      const msg = e.data;
      if (msg.type === 'ready') {
        state.workerReady = true;
        renderCurrentTab();
      }
    });

    state.worker.addEventListener('error', function (err) {
      console.error('Worker error:', err);
      state.workerReady = false;
      if (state._filterPromise) {
        state._filterPromise._reject(err);
        state._filterPromise = null;
      }
      renderCurrentTab();
    });

    state.worker.addEventListener('messageerror', function () {
      console.error('Worker message error');
      state.workerReady = false;
      if (state._filterPromise) {
        state._filterPromise._reject(new Error('Worker message error'));
        state._filterPromise = null;
      }
      renderCurrentTab();
    });

    state.worker.postMessage({
      type: 'init',
      data: {
        contributions: state.data.contributions,
        contributors: state.data.contributors,
        frequency: state.data.frequency,
        summary: state.data.summary
      }
    });
  } catch (err) {
    console.error('Failed to create worker:', err);
    state.workerReady = false;
    renderCurrentTab();
  }
}

async function loadData() {
  try {
    const res = await fetch('/data/summary.json');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const summary = await res.json();

    state.data = { summary };

    document.getElementById('metric-commits').textContent = formatNumber(summary.totalCommits);
    document.getElementById('metric-contributors').textContent = formatNumber(
      summary.totalContributors
    );
    document.getElementById('metric-additions').textContent = formatNumber(summary.totalAdditions);
    document.getElementById('metric-deletions').textContent = formatNumber(summary.totalDeletions);

    const [contributions, contributors, frequency] = await Promise.all([
      fetch('/data/contributions.json').then(function (r) {
        return r.json();
      }),
      fetch('/data/contributors.json').then(function (r) {
        return r.json();
      }),
      fetch('/data/frequency.json').then(function (r) {
        return r.json();
      })
    ]);

    state.data.contributions = contributions;
    state.data.contributors = contributors;
    state.data.frequency = frequency;

    TABS.forEach(function (t) {
      clearStates(t);
    });

    initWorker();
  } catch (err) {
    console.error('Failed to load data:', err);
    TABS.forEach(function (t) {
      showError(
        t,
        'Failed to load dashboard data. Ensure the server is running and the repository has been analyzed.'
      );
    });
    throw err;
  }
}

// ═════════════════════════════════════════════════════════════════════
//  THEME
// ═════════════════════════════════════════════════════════════════════

function detectTheme() {
  let saved;
  try {
    saved = localStorage.getItem('repodash-theme');
  } catch {
    /* localStorage unavailable */
  }
  if (saved === 'dark' || saved === 'light') return saved;
  if (globalThis.window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

function applyTheme(theme) {
  state.theme = theme;
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem('repodash-theme', theme);
  } catch {
    /* localStorage unavailable */
  }

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute(
      'content',
      getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
    );
  }
  updateAllChartColors();
}

function toggleTheme() {
  applyTheme(state.theme === 'dark' ? 'light' : 'dark');
}

// ═════════════════════════════════════════════════════════════════════
//  TAB SWITCHING & TIME FILTER
// ═════════════════════════════════════════════════════════════════════

function syncTabUI(tabName) {
  document.querySelectorAll('.tab').forEach(function (btn) {
    const match = btn.dataset.tab === tabName;
    btn.classList.toggle('active', match);
    btn.setAttribute('aria-selected', String(match));
  });
  document.querySelectorAll('.tab-content').forEach(function (sec) {
    sec.classList.toggle('active', sec.id === 'tab-' + tabName);
  });
}

function switchTab(tabName) {
  if (state.activeTab === tabName) return;
  state.activeTab = tabName;

  globalThis.window.location.hash = tabName;
  syncTabUI(tabName);
  _clearChartQueue();

  if (!state.data) {
    initEmptyCharts(tabName);
  }

  renderCurrentTab();
}

function setTimeFilter(filter) {
  if (state.timeFilter === filter && filter !== 'custom') return;
  state.timeFilter = filter;
  state._filterCacheKey = null;
  state._filterCache = null;
  state.contributorsPage = 1;

  try {
    const url = new URL(globalThis.window.location.href);
    url.searchParams.set('filter', filter);
    if (filter === 'custom') {
      if (state.customStartDate) url.searchParams.set('start', state.customStartDate);
      else url.searchParams.delete('start');
      if (state.customEndDate) url.searchParams.set('end', state.customEndDate);
      else url.searchParams.delete('end');
    }
    globalThis.window.history.replaceState(null, '', url);
  } catch {
    /* ignore */
  }

  document.querySelectorAll('.pill').forEach(function (btn) {
    const isActive = btn.dataset.filter === filter;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-checked', String(isActive));
  });

  const customRange = document.getElementById('custom-date-range');
  if (customRange) {
    customRange.classList.toggle('hidden', filter !== 'custom');
  }

  renderCurrentTab();
}

function getFilteredData(allTabs) {
  if (!state.data?.contributions) return null;

  const key =
    state.timeFilter +
    '|' +
    (state.customStartDate || '') +
    '|' +
    (state.customEndDate || '') +
    '|' +
    state.activeTab +
    '|' +
    state.contributorsSortBy +
    '|' +
    state.contributorsSortOrder;

  if (!allTabs) {
    if (state._filterCacheKey === key && state._filterCache) {
      return state._filterCache;
    }

    if (state.worker && state.workerReady) {
      if (state._filterPromise?._key === key) {
        return state._filterPromise;
      }

      const id = ++_requestId;
      let rejectFn;
      const promise = new Promise(function (resolve, reject) {
        rejectFn = reject;
        const handler = function (e) {
          if (e.data.type === 'result' && e.data.requestId === id) {
            state.worker.removeEventListener('message', handler);
            state._filterPromise = null;
            state._filterCacheKey = key;
            state._filterCache = e.data.data;
            resolve(e.data.data);
          } else if (e.data.type === 'error' && e.data.requestId === id) {
            state.worker.removeEventListener('message', handler);
            state._filterPromise = null;
            reject(new Error(e.data.message || 'Worker error'));
          }
        };

        state.worker.addEventListener('message', handler);

        state.worker.postMessage({
          type: 'filter',
          requestId: id,
          filter: state.timeFilter,
          customStartDate: state.customStartDate,
          customEndDate: state.customEndDate,
          activeTab: state.activeTab,
          sortBy: state.contributorsSortBy,
          sortOrder: state.contributorsSortOrder
        });
      });
      promise._key = key;
      promise._reject = rejectFn;
      state._filterPromise = promise;
      return promise;
    }
  }

  const bounds = getCutoffDate(state.timeFilter, state.customStartDate, state.customEndDate);
  const filteredContributions = filterByDate(state.data.contributions, bounds);
  const filteredFrequency = filterByDate(state.data.frequency, bounds);

  const result = {};
  result.contributions = downsampleData(filteredContributions, MAX_CHART_POINTS);

  if (allTabs) {
    result.summary = computeFilteredSummary(filteredContributions, filteredFrequency);
    result.frequency = downsampleData(filteredFrequency, MAX_CHART_POINTS);
    result.contributors = computeFilteredContributors(
      filteredContributions,
      state.data.contributors
    );
    result.activity = computeFilteredActivity(filteredContributions);
  } else if (state.activeTab === 'overview') {
    result.summary = computeFilteredSummary(filteredContributions, filteredFrequency);
    result.contributors = computeFilteredContributors(
      filteredContributions,
      state.data.contributors
    );
    result.frequency = downsampleData(filteredFrequency, MAX_CHART_POINTS);
  } else if (state.activeTab === 'contributors') {
    result.contributors = sortContributors(
      computeFilteredContributors(filteredContributions, state.data.contributors),
      state.contributorsSortBy,
      state.contributorsSortOrder
    );
  } else if (state.activeTab === 'activity') {
    result.activity = computeFilteredActivity(filteredContributions);
  }

  if (!allTabs) {
    state._filterCacheKey = key;
    state._filterCache = result;
  }
  return result;
}

async function renderCurrentTab() {
  const mainContent = document.getElementById('main-content');
  if (mainContent) {
    mainContent.setAttribute('aria-busy', 'true');
  }
  try {
    if (!state.data?.contributions) return;

    let d = getFilteredData();
    if (d && typeof d.then === 'function') {
      d = await Promise.race([
        d,
        new Promise(function (_, reject) {
          setTimeout(function () {
            reject(new Error('Worker filter timed out'));
          }, 15000);
        })
      ]).catch(function (err) {
        console.error('Filter failed, falling back to main thread:', err);
        state.workerReady = false;
        return getFilteredData();
      });
    }
    if (!d) return;

    switch (state.activeTab) {
      case 'overview':
        renderOverview(d);
        break;
      case 'contributors':
        renderContributors(d);
        break;
      case 'activity':
        renderActivity(d);
        break;
    }
  } finally {
    if (mainContent) {
      mainContent.setAttribute('aria-busy', 'false');
    }
  }
}

// ═════════════════════════════════════════════════════════════════════
//  OVERVIEW TAB
// ═════════════════════════════════════════════════════════════════════

function renderOverview(d) {
  clearStates('overview');

  document.getElementById('metric-commits').textContent = formatNumber(d.summary.totalCommits);
  document.getElementById('metric-contributors').textContent = formatNumber(
    d.summary.totalContributors
  );
  document.getElementById('metric-additions').textContent = formatNumber(d.summary.totalAdditions);
  document.getElementById('metric-deletions').textContent = formatNumber(d.summary.totalDeletions);

  if (!d.contributions?.length) {
    destroyChart('chart-contribution');
    destroyChart('chart-top-contributors');
    destroyChart('chart-frequency-overview');
    showEmpty('overview');
    return;
  }

  renderContributionChart(d.contributions, state.contributionMode, d.contributors);
  renderTopContributorsChart(d.contributors, state.topContributorsMode);
  renderFrequencyOverviewChart(d.frequency);
}

// -- Contribution chart (multi-mode) -----------------------------------

function renderContributionChart(contributions, mode, contributors) {
  if (!contributions?.length) return;
  mode = mode || 'author';

  if (mode === 'commits') {
    renderContributionCommits(contributions);
  } else {
    renderContributionAuthor(contributions, contributors);
  }
}

function buildOthersDataset(contributions, topAuthors) {
  if (!topAuthors.length) return null;
  const topSet = {};
  topAuthors.forEach(function (x) {
    topSet[x.key] = true;
  });
  return {
    label: 'Others',
    data: contributions.map(function (day) {
      let sum = 0;
      (day.authorDetails || []).forEach(function (a) {
        if (!topSet[a.author]) sum += a.count;
      });
      return sum;
    }),
    backgroundColor: '#8b949e',
    borderWidth: 0,
    borderRadius: 2
  };
}

function renderContributionAuthor(contributions, contributors) {
  contributions = downsampleData(contributions, MAX_CHART_POINTS);
  const TOP = 10;
  const seen = {};
  const authorKeys = [];
  (contributors || []).forEach(function (c) {
    const key = c.name?.trim() || c.email;
    if (!seen[key]) {
      seen[key] = true;
      authorKeys.push({ key: key, label: key });
    }
  });
  const topAuthors = authorKeys.slice(0, TOP);
  const hasOthers = authorKeys.length > TOP;

  const authorDayIndex = {};
  topAuthors.forEach(function (a) {
    authorDayIndex[a.key] = {};
  });

  contributions.forEach(function (day) {
    (day.authorDetails || []).forEach(function (a) {
      if (authorDayIndex[a.author]) {
        authorDayIndex[a.author][day.date] = a.count;
      }
    });
  });

  const datasets = [];
  topAuthors.forEach(function (a, i) {
    const lookup = authorDayIndex[a.key] || {};
    datasets.push({
      label: a.label,
      data: contributions.map(function (day) {
        return lookup[day.date] || 0;
      }),
      backgroundColor: globalThis.window.COLOR_LIST[i % globalThis.window.COLOR_LIST.length],
      borderWidth: 0,
      borderRadius: 2
    });
  });

  if (hasOthers) {
    const othersDataset = buildOthersDataset(contributions, topAuthors);
    if (othersDataset) datasets.push(othersDataset);
  }

  scheduleChart(
    'chart-contribution',
    'bar',
    {
      labels: contributions.map(function (d) {
        return d.date;
      }),
      datasets: datasets
    },
    {
      scales: {
        x: {
          stacked: true,
          maxTicksLimit: contributions.length > 90 ? 12 : undefined
        },
        y: {
          stacked: true,
          title: { display: true, text: 'Commits' }
        }
      },
      plugins: {
        legend: {
          display: true,
          position: 'bottom',
          labels: { boxWidth: 12, padding: 12 }
        }
      }
    }
  );
}

function renderContributionCommits(contributions) {
  const display = downsampleData(contributions, MAX_CHART_POINTS);
  scheduleChart(
    'chart-contribution',
    'bar',
    {
      labels: display.map(function (d) {
        return d.date;
      }),
      datasets: [
        {
          label: 'Commits',
          data: display.map(function (d) {
            return d.count;
          }),
          backgroundColor: globalThis.window.COLORS.blue,
          borderWidth: 0,
          borderRadius: 2
        }
      ]
    },
    {
      scales: {
        x: {
          stacked: false,
          maxTicksLimit: display.length > 90 ? 12 : undefined
        },
        y: {
          stacked: false,
          beginAtZero: true,
          title: { display: true, text: 'Commits' }
        }
      },
      plugins: {
        legend: { display: false }
      }
    }
  );
}

// -- Top contributors horizontal bar -----------------------------------

function renderTopContributorsChart(contributors, mode = 'commits') {
  if (!contributors?.length) return;
  const top = contributors.slice(0, 10);

  let label, data;
  if (mode === 'additions') {
    label = 'Additions';
    data = top.map(function (c) {
      return c.additions;
    });
  } else if (mode === 'deletions') {
    label = 'Deletions';
    data = top.map(function (c) {
      return c.deletions;
    });
  } else {
    label = 'Commits';
    data = top.map(function (c) {
      return c.totalCommits;
    });
  }

  scheduleChart(
    'chart-top-contributors',
    'bar',
    {
      labels: top.map(function (c) {
        return c.name?.trim() || c.email;
      }),
      datasets: [
        {
          label: label,
          data: data,
          backgroundColor: globalThis.window.COLORS.blue,
          borderWidth: 0,
          borderRadius: 2
        }
      ]
    },
    {
      indexAxis: 'y',
      scales: {
        x: { beginAtZero: true },
        y: { grid: { display: false } }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          mode: 'y',
          intersect: false
        }
      }
    }
  );
}

// -- Code frequency line chart -----------------------------------

function renderFrequencyLineChart(frequency, chartId, alpha, pointRadius, pointHoverRadius) {
  if (!frequency?.length) {
    destroyChart(chartId);
    return;
  }

  frequency = downsampleData(frequency, MAX_CHART_POINTS);

  scheduleChart(
    chartId,
    'line',
    {
      labels: frequency.map(function (x) {
        return x.date;
      }),
      datasets: [
        {
          label: 'Additions',
          data: frequency.map(function (x) {
            return x.additions;
          }),
          borderColor: globalThis.window.COLORS.green,
          backgroundColor: globalThis.window.COLORS.green + alpha,
          fill: true,
          tension: 0.3,
          pointRadius: pointRadius,
          pointHoverRadius: pointHoverRadius,
          borderWidth: 2
        },
        {
          label: 'Deletions',
          data: frequency.map(function (x) {
            return x.deletions;
          }),
          borderColor: globalThis.window.COLORS.red,
          backgroundColor: globalThis.window.COLORS.red + alpha,
          fill: true,
          tension: 0.3,
          pointRadius: pointRadius,
          pointHoverRadius: pointHoverRadius,
          borderWidth: 2
        }
      ]
    },
    lineChartOptions(frequency)
  );
}

// -- Code frequency overview chart -----------------------------------

function renderFrequencyOverviewChart(frequency) {
  renderFrequencyLineChart(
    frequency,
    'chart-frequency-overview',
    '30',
    frequency && frequency.length < 60 ? 2 : 0,
    4
  );
}

// ═════════════════════════════════════════════════════════════════════
//  CONTRIBUTORS TAB
// ═════════════════════════════════════════════════════════════════════

function updateContributorsThead() {
  const thead = document.querySelector('#contributors-table thead');
  if (!thead) return;
  const ths = thead.querySelectorAll('th');
  ths.forEach(function (th) {
    const sortBy = th.dataset.sortBy;
    const svg = th.querySelector('.sort-indicator');

    if (sortBy === state.contributorsSortBy) {
      th.classList.add('active');
      th.setAttribute(
        'aria-sort',
        state.contributorsSortOrder === 'asc' ? 'ascending' : 'descending'
      );
      // Update aria-label to indicate sort direction
      const label = th.getAttribute('aria-label');
      if (label) {
        const newLabel =
          label.replace(/\s\(.*\)/, '') +
          ` (${state.contributorsSortOrder === 'asc' ? 'ascending' : 'descending'})`;
        th.setAttribute('aria-label', newLabel);
      }
      if (svg) {
        svg.classList.toggle('asc', state.contributorsSortOrder === 'asc');
      }
    } else {
      th.classList.remove('active');
      th.removeAttribute('aria-sort');
      if (svg) svg.classList.remove('asc');
    }
  });
}

function renderContributorsTable(contributors) {
  updateContributorsThead();

  const tbody = document.querySelector('#contributors-table tbody');
  tbody.innerHTML = '';
  contributors.forEach(function (c) {
    const tr = document.createElement('tr');
    const displayName = c.name?.trim() || c.email;
    const titleText = c.name?.trim() && c.email ? c.name?.trim() + ' <' + c.email + '>' : c.email;
    tr.innerHTML =
      '<td title="' +
      escapeHtml(titleText) +
      '">' +
      escapeHtml(displayName) +
      '</td>' +
      '<td class="num-col">' +
      formatNumber(c.totalCommits) +
      '</td>' +
      '<td class="num-col">' +
      formatNumber(c.additions) +
      '</td>' +
      '<td class="num-col">' +
      formatNumber(c.deletions) +
      '</td>' +
      '<td>' +
      formatDate(c.firstCommit) +
      '</td>' +
      '<td>' +
      formatDate(c.lastCommit) +
      '</td>';
    tbody.appendChild(tr);
  });
}

function renderContributorsPagination(total, totalPages) {
  const page = state.contributorsPage;
  const pageSize = state.contributorsPageSize;
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  const info = document.getElementById('page-info');
  if (info) {
    info.textContent =
      'Page ' +
      page +
      ' of ' +
      totalPages +
      ' \u2014 Showing ' +
      start +
      '\u2013' +
      end +
      ' of ' +
      total;
  }

  const prevBtn = document.getElementById('prev-page');
  const nextBtn = document.getElementById('next-page');
  if (prevBtn) {
    prevBtn.disabled = page <= 1;
    // Fix: Show proper page number or no label when disabled
    if (page <= 1) {
      prevBtn.setAttribute('aria-label', 'Previous page');
    } else {
      prevBtn.setAttribute('aria-label', `Previous page (page ${page - 1} of ${totalPages})`);
    }
  }
  if (nextBtn) {
    nextBtn.disabled = page >= totalPages;
    // Fix: Show proper page number or no label when disabled
    if (page >= totalPages) {
      nextBtn.setAttribute('aria-label', 'Next page');
    } else {
      nextBtn.setAttribute('aria-label', `Next page (page ${page + 1} of ${totalPages})`);
    }
  }

  const sizeSelect = document.getElementById('page-size');
  if (sizeSelect) sizeSelect.value = String(pageSize);
}

function renderContributorBarChart(contributors) {
  const barHeight = 14;
  const maxChartHeight = 560;
  const maxBars = Math.floor(maxChartHeight / barHeight);
  const list = contributors.slice(0, maxBars).reverse();
  const chartHeight = Math.max(320, list.length * barHeight);

  const wrap = document.getElementById('chart-contributor-distribution').parentElement;
  wrap.style.height = chartHeight + 'px';

  scheduleChart(
    'chart-contributor-distribution',
    'bar',
    {
      labels: list.map(function (c) {
        return c.name?.trim() || c.email;
      }),
      datasets: [
        {
          label: 'Commits',
          data: list.map(function (c) {
            return c.totalCommits;
          }),
          backgroundColor: list.map(function (_, i) {
            return globalThis.window.COLOR_LIST[i % globalThis.window.COLOR_LIST.length];
          }),
          borderWidth: 0,
          borderRadius: 2,
          barThickness: 12
        }
      ]
    },
    {
      indexAxis: 'y',
      scales: {
        y: {
          ticks: { font: { size: 11 }, autoSkip: false },
          grid: { display: false }
        },
        x: { beginAtZero: true }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          mode: 'y',
          intersect: false
        }
      }
    }
  );
}

function renderContributors(d) {
  clearStates('contributors');
  if (!d.contributors?.length) {
    destroyChart('chart-contributor-distribution');
    showEmpty('contributors');
    return;
  }

  // d.contributors is already sorted by getFilteredData
  const list = d.contributors;
  const total = list.length;
  const pageSize = state.contributorsPageSize;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Clamp current page after filtering/sorting changes
  if (state.contributorsPage > totalPages) state.contributorsPage = totalPages;

  const start = (state.contributorsPage - 1) * pageSize;
  const pageItems = list.slice(start, start + pageSize);

  renderContributorsTable(pageItems);
  renderContributorBarChart(list);
  renderContributorsPagination(total, totalPages);
}

function setupContributorsSort() {
  const thead = document.querySelector('#contributors-table thead');
  if (!thead) return;

  async function sortByColumn(th) {
    const sortBy = th.dataset.sortBy;
    if (!sortBy) return;
    if (state.contributorsSortBy === sortBy) {
      state.contributorsSortOrder = state.contributorsSortOrder === 'asc' ? 'desc' : 'asc';
    } else {
      state.contributorsSortBy = sortBy;
      state.contributorsSortOrder = sortBy === 'name' ? 'asc' : 'desc';
    }
    state._filterCacheKey = null;
    state._filterCache = null;
    state.contributorsPage = 1;

    let d = getFilteredData();
    if (d && typeof d.then === 'function') d = await d;
    if (d) {
      d.contributors = sortContributors(
        d.contributors,
        state.contributorsSortBy,
        state.contributorsSortOrder
      );
      renderContributors(d);
    }
  }

  thead.addEventListener('click', function (e) {
    const th = e.target.closest('th[data-sort-by]');
    if (!th) return;
    sortByColumn(th);
  });

  thead.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') {
      const th = e.target.closest('th[data-sort-by]');
      if (!th) return;
      e.preventDefault();
      sortByColumn(th);
    }
  });
}

function setupContributorsPagination() {
  async function goToPage(page) {
    const list = state._filterCache?.contributors;
    if (!list?.length) return;

    const totalPages = Math.ceil(list.length / state.contributorsPageSize);
    state.contributorsPage = Math.max(1, Math.min(page, totalPages));

    const start = (state.contributorsPage - 1) * state.contributorsPageSize;
    const pageItems = list.slice(start, start + state.contributorsPageSize);

    renderContributorsTable(pageItems);
    renderContributorsPagination(list.length, totalPages);
  }

  const prevBtn = document.getElementById('prev-page');
  const nextBtn = document.getElementById('next-page');

  if (prevBtn) {
    prevBtn.addEventListener('click', async function () {
      await goToPage(state.contributorsPage - 1);
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener('click', async function () {
      await goToPage(state.contributorsPage + 1);
    });
  }

  const sizeSelect = document.getElementById('page-size');
  if (sizeSelect) {
    sizeSelect.addEventListener('change', async function () {
      state.contributorsPageSize = Number(sizeSelect.value);
      state.contributorsPage = 1;
      let d = getFilteredData();
      if (d && typeof d.then === 'function') d = await d;
      if (d) {
        d.contributors = sortContributors(
          d.contributors,
          state.contributorsSortBy,
          state.contributorsSortOrder
        );
        renderContributors(d);
      }
    });
  }
}

// ═════════════════════════════════════════════════════════════════════
//  ACTIVITY TAB
// ═════════════════════════════════════════════════════════════════════

function renderTopFilesTable(a) {
  const tbody = document.querySelector('#topfiles-table tbody');
  if (tbody) tbody.innerHTML = '';
  if (a.topFiles?.length) {
    const fileCount = document.body.classList.contains('printing') ? 20 : 10;
    a.topFiles.slice(0, fileCount).forEach(function (f) {
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td><code class="file-path">' +
        escapeHtml(f.path) +
        '</code></td>' +
        '<td class="num-col">' +
        formatNumber(f.changes) +
        '</td>';
      tbody.appendChild(tr);
    });
  }
}

function renderActivityBarChart(chartId, items, color, labelMapper) {
  destroyChart(chartId);
  if (!items?.length) return;
  scheduleChart(
    chartId,
    'bar',
    {
      labels: items.map(labelMapper),
      datasets: [
        {
          label: 'Commits',
          data: items.map(function (x) {
            return x.count;
          }),
          backgroundColor: color,
          borderWidth: 0,
          borderRadius: 2
        }
      ]
    },
    { plugins: { legend: { display: false } } }
  );
}

function renderActivity(d) {
  clearStates('activity');
  const a = d.activity;
  if (!a) {
    showEmpty('activity');
    return;
  }

  const hasWeek = a.byDayOfWeek?.some(function (x) {
    return x.count > 0;
  });
  const hasHour = a.byHour?.some(function (x) {
    return x.count > 0;
  });
  const hasFiles = a.topFiles?.length > 0;

  if (!hasWeek && !hasHour && !hasFiles) {
    destroyChart('chart-dayofweek');
    destroyChart('chart-hour');
    showEmpty('activity');
    return;
  }

  renderActivityBarChart(
    'chart-dayofweek',
    a.byDayOfWeek,
    globalThis.window.COLORS.purple,
    function (x) {
      return x.day;
    }
  );
  renderActivityBarChart('chart-hour', a.byHour, globalThis.window.COLORS.orange, function (x) {
    return String(x.hour).padStart(2, '0') + ':00';
  });

  renderTopFilesTable(a);
}

// ═════════════════════════════════════════════════════════════════════
//  EVENT LISTENERS
// ═════════════════════════════════════════════════════════════════════

function setupModeSelect(selectId, stateKey, renderFn) {
  const el = document.getElementById(selectId);
  if (el) {
    const debouncedRender = debounce(async function () {
      if (state.activeTab === 'overview') {
        let d = getFilteredData();
        if (d && typeof d.then === 'function') d = await d;
        if (d) renderFn(d);
      }
    }, 300);
    el.addEventListener('change', function () {
      state[stateKey] = el.value;
      state._filterCacheKey = null;
      state._filterCache = null;
      debouncedRender();
    });
  }
}

function setupKeyboardNav() {
  const tabsBar = document.querySelector('.tabs');
  if (tabsBar) {
    tabsBar.addEventListener('keydown', function (e) {
      const tabs = Array.prototype.slice.call(tabsBar.querySelectorAll('.tab'));
      const idx = tabs.indexOf(document.activeElement);
      if (idx === -1) return;

      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const next =
          e.key === 'ArrowRight' ? (idx + 1) % tabs.length : (idx - 1 + tabs.length) % tabs.length;
        const nextTab = tabs[next];
        const tabName = nextTab.dataset.tab;
        if (tabName) switchTab(tabName);
        nextTab.focus();
      }
    });
  }
}

function setupTimeFilterKeyboardNav() {
  const container = document.querySelector('.time-filter');
  if (!container) return;

  container.addEventListener('keydown', function (e) {
    const pills = Array.prototype.slice.call(container.querySelectorAll('.pill'));
    const idx = pills.indexOf(document.activeElement);
    if (idx === -1) return;

    let nextIdx = -1;

    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      nextIdx = (idx - 1 + pills.length) % pills.length;
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      nextIdx = (idx + 1) % pills.length;
    } else if (e.key === 'Home') {
      e.preventDefault();
      nextIdx = 0;
    } else if (e.key === 'End') {
      e.preventDefault();
      nextIdx = pills.length - 1;
    }

    if (nextIdx >= 0) {
      const target = pills[nextIdx];
      pills.forEach(function (p) {
        p.setAttribute('tabindex', '-1');
      });
      target.setAttribute('tabindex', '0');
      target.focus();

      if (!target.classList.contains('active')) {
        setTimeFilter(target.dataset.filter);
      }
    }
  });
}

function setupDateRangeListeners() {
  const dateStart = document.getElementById('date-start');
  const dateEnd = document.getElementById('date-end');

  function handleInput(inputEl, stateKey, getMin, postSet) {
    inputEl.addEventListener('input', function () {
      const val = inputEl.value;
      if (val.length !== 10 || Number.isNaN(new Date(val).getTime())) {
        if (state[stateKey] !== null) state[stateKey] = null;
        return;
      }
      const today = getTodayLocal();
      const date = clampDate(val, getMin(), today);
      state[stateKey] = date;
      inputEl.value = date || '';
      if (postSet) postSet(date, today);
      setTimeFilter('custom');
    });
  }

  if (dateStart) {
    handleInput(
      dateStart,
      'customStartDate',
      function () {
        return state.data?.summary ? state.data.summary.firstCommit : null;
      },
      function (date, today) {
        if (date && state.customEndDate && state.customEndDate < date) {
          state.customEndDate = clampDate(date, null, today);
          if (dateEnd) dateEnd.value = state.customEndDate;
        }
      }
    );
  }
  if (dateEnd) {
    handleInput(dateEnd, 'customEndDate', function () {
      return state.customStartDate || null;
    });
  }
}

function setupTabListeners() {
  document.querySelectorAll('.tab').forEach(function (btn) {
    btn.addEventListener('click', function () {
      switchTab(btn.dataset.tab);
    });
  });

  document.querySelectorAll('.pill').forEach(function (btn) {
    btn.addEventListener('click', function () {
      setTimeFilter(btn.dataset.filter);
    });
  });
}

function setupExportPdf() {
  const exportBtn = document.getElementById('export-pdf');
  if (!exportBtn) return;

  async function loadPdfDependencies() {
    if (globalThis.window.html2canvas && globalThis.window.jspdf) return;

    async function loadScript(src, timeout = 10000) {
      return new Promise(function (resolve, reject) {
        const s = document.createElement('script');
        s.src = src;
        const timer = setTimeout(function () {
          reject(new Error('Script loading timeout'));
        }, timeout);
        s.onload = function () {
          clearTimeout(timer);
          resolve();
        };
        s.onerror = function () {
          clearTimeout(timer);
          reject(new Error('Script failed to load'));
        };
        document.head.appendChild(s);
      });
    }

    try {
      await loadScript('https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js');
      await loadScript('https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js');
      await loadScript(
        'https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.3/dist/jspdf.plugin.autotable.min.js'
      );
    } catch (error) {
      throw new Error('Failed to load PDF dependencies: ' + error.message, { cause: error });
    }
  }

  exportBtn.addEventListener('click', async function () {
    const overlay = document.getElementById('export-overlay');
    if (overlay) {
      const style = getComputedStyle(document.documentElement);
      overlay.style.background = style.getPropertyValue('--bg').trim() || '#ffffff';
      overlay.style.color = style.getPropertyValue('--text').trim() || '#000000';
      overlay.classList.remove('hidden');
      overlay.focus();
    }

    if (!globalThis.window.html2canvas || !globalThis.window.jspdf) {
      if (overlay) overlay.querySelector('span').textContent = 'Loading PDF dependencies…';
      try {
        await loadPdfDependencies();
        if (!globalThis.window.html2canvas || !globalThis.window.jspdf) {
          throw new Error('PDF dependencies did not load');
        }
        if (overlay) overlay.querySelector('span').textContent = 'Generating PDF…';
        // Ensure screen readers announce the update
        if (overlay) {
          const liveRegion = overlay.querySelector('[aria-live]');
          if (liveRegion) {
            liveRegion.textContent = 'Generating PDF…';
          }
        }
      } catch {
        if (overlay)
          overlay.querySelector('span').textContent =
            'PDF export unavailable — check your connection';
        exportBtn.disabled = false;
        return;
      }
    }

    let filtered = getFilteredData(true);
    if (filtered && typeof filtered.then === 'function') filtered = await filtered;
    if (!filtered?.contributions?.length) {
      if (overlay) overlay.classList.add('hidden');
      return;
    }

    const btnText = exportBtn.querySelector('span');
    const originalBtnText = btnText ? btnText.textContent : 'Export PDF';
    exportBtn.disabled = true;
    if (btnText) btnText.textContent = 'Generating\u2026';

    const titleEl = document.querySelector('.header-title');
    const originalTitle = titleEl ? titleEl.textContent : 'Insights';

    const dateLabel = getDateRangeLabel(filtered);
    const repoName = state.data.summary?.repoName || '';
    const printTitle = repoName ? repoName + ' Insights: ' + dateLabel : 'Insights: ' + dateLabel;
    if (titleEl) titleEl.textContent = printTitle;
    const originalDocTitle = document.title;
    document.title = printTitle;

    document.body.classList.add('printing');
    const savedTheme = state.theme;
    (function () {
      return document.body.offsetHeight;
    })();
    document.body.style.overflow = 'hidden';

    applyTheme('light');

    try {
      renderOverview(filtered);
      renderContributors(filtered);
      renderActivity(filtered);

      Object.keys(state.charts).forEach(function (id) {
        try {
          state.charts[id].resize(null, { duration: 0 });
        } catch {
          /* ignore individual chart resize failures */
        }
      });

      await new Promise(function (r) {
        setTimeout(r, 600);
      });

      const { jsPDF } = globalThis.window.jspdf;
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 15;
      const usableWidth = pageWidth - margin * 2;

      let unicodeFont = 'helvetica';

      try {
        const resp = await fetch('fonts/NotoSansMultilanguage-Regular.ttf');
        if (resp.ok) {
          const buf = await resp.arrayBuffer();
          const bytes = new Uint8Array(buf);
          let binary = '';
          for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
          }
          pdf.addFileToVFS('NotoSansMultilanguage-Regular.ttf', btoa(binary));
          pdf.addFont('NotoSansMultilanguage-Regular.ttf', 'NotoSansMultilanguage', 'normal');
          unicodeFont = 'NotoSansMultilanguage';
        }
      } catch {
        /* fall back to helvetica */
      }
      pdf.setFont(unicodeFont, 'normal');

      async function captureElement(el) {
        const origGetContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (type, attrs) {
          if (type === '2d') {
            return origGetContext.call(this, type, { ...attrs, willReadFrequently: true });
          }
          return origGetContext.call(this, type, attrs);
        };
        try {
          const canvas = await globalThis.window.html2canvas(el, {
            backgroundColor: '#ffffff',
            scale: 2,
            useCORS: true,
            logging: false
          });
          return canvas;
        } finally {
          HTMLCanvasElement.prototype.getContext = origGetContext;
        }
      }

      async function addChartToPdf(pdf, el, usableWidth, y, margin, pageHeight) {
        const canvas = await captureElement(el);
        const imgH = (usableWidth * canvas.height) / canvas.width;
        if (y + imgH > pageHeight - margin) {
          pdf.addPage();
          y = margin;
        }
        pdf.addImage(canvas.toDataURL('image/png'), 'PNG', margin, y, usableWidth, imgH);
        return y + imgH + 6;
      }

      function pageFooter(pdf, pageWidth, margin, pageHeight) {
        return function () {
          pdf.setFontSize(8);
          pdf.text('Page ' + pdf.internal.getNumberOfPages(), pageWidth - margin, pageHeight - 5, {
            align: 'right'
          });
        };
      }

      const tableBase = {
        margin: { top: margin, bottom: margin },
        tableWidth: 'auto',
        showHead: 'everyPage',
        didDrawPage: pageFooter(pdf, pageWidth, margin, pageHeight)
      };

      let y = margin;

      pdf.setFontSize(16);
      pdf.text(printTitle, margin, y);
      y += 10;

      const metricEl = document.querySelector('.metric-grid');
      if (metricEl) {
        y = await addChartToPdf(pdf, metricEl, usableWidth, y, margin, pageHeight);
      }

      const overviewCharts = document.querySelectorAll('#tab-overview .chart-card');
      for (let i = 0; i < overviewCharts.length; i++) {
        y = await addChartToPdf(pdf, overviewCharts[i], usableWidth, y, margin, pageHeight);
      }

      const contributors = sortContributors(
        filtered.contributors,
        state.contributorsSortBy,
        state.contributorsSortOrder
      );
      if (contributors?.length) {
        pdf.autoTable({
          head: [['Name', 'Commits', 'Additions', 'Deletions', 'First Commit', 'Last Commit']],
          body: contributors.map(function (c) {
            return [
              c.name?.trim() || c.email,
              formatNumber(c.totalCommits),
              formatNumber(c.additions),
              formatNumber(c.deletions),
              formatDate(c.firstCommit),
              formatDate(c.lastCommit)
            ];
          }),
          startY: y,
          styles: { fontSize: 7, cellPadding: 2, font: unicodeFont, fontStyle: 'normal' },
          headStyles: {
            fillColor: [88, 166, 255],
            fontSize: 8,
            font: unicodeFont,
            fontStyle: 'normal'
          },
          alternateRowStyles: { fillColor: [245, 247, 250] },
          columnStyles: {
            1: { halign: 'center' },
            2: { halign: 'center' },
            3: { halign: 'center' }
          },
          didParseCell: function (data) {
            if (
              data.section === 'head' &&
              (data.column.index === 1 || data.column.index === 2 || data.column.index === 3)
            ) {
              data.cell.styles.halign = 'center';
            }
          },
          ...tableBase
        });
        y = pdf.lastAutoTable.finalY + 10;
      }

      const otherCharts = Array.from(
        document.querySelectorAll('#tab-contributors .chart-card, #tab-activity .chart-card')
      ).filter(function (el) {
        return !el.querySelector('#topfiles-table');
      });
      for (let i = 0; i < otherCharts.length; i++) {
        y = await addChartToPdf(pdf, otherCharts[i], usableWidth, y, margin, pageHeight);
      }

      const topFiles = filtered.activity?.topFiles;
      if (topFiles?.length) {
        pdf.addPage();
        y = margin;
        pdf.setFontSize(12);
        pdf.text('Top Changed Files', margin, y);
        y += 6;
        pdf.autoTable({
          head: [['File', 'Changes']],
          body: topFiles.map(function (f) {
            return [f.path, formatNumber(f.changes)];
          }),
          startY: y,
          styles: { fontSize: 7, cellPadding: 2, font: unicodeFont },
          headStyles: { fillColor: [88, 166, 255], fontSize: 8, font: unicodeFont },
          alternateRowStyles: { fillColor: [245, 247, 250] },
          columnStyles: { 1: { halign: 'center' } },
          didParseCell: function (data) {
            if (data.section === 'head' && data.column.index === 1) {
              data.cell.styles.halign = 'center';
            }
          },
          ...tableBase
        });
        y = pdf.lastAutoTable.finalY + 10;
      }

      const fileSafeName = dateLabel
        .replace(/[^a-zA-Z0-9]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
      pdf.save((repoName || 'repodash') + '-' + fileSafeName + '.pdf');
    } catch (err) {
      console.error('PDF generation failed:', err);
      exportBtn.classList.add('export-error');
      setTimeout(function () {
        exportBtn.classList.remove('export-error');
      }, 3000);
    } finally {
      if (overlay) {
        overlay.classList.add('hidden');
        overlay.style.background = '';
        overlay.style.color = '';
        exportBtn.focus();
      }
      document.body.style.overflow = '';
      if (titleEl) titleEl.textContent = originalTitle;
      document.title = originalDocTitle;
      document.body.classList.remove('printing');
      if (savedTheme) applyTheme(savedTheme);
      exportBtn.disabled = false;
      if (btnText) btnText.textContent = originalBtnText;
      renderCurrentTab();
    }
  });
}

function setupEvents() {
  document.getElementById('theme-toggle').addEventListener('click', toggleTheme);

  setupExportPdf();

  if (globalThis.window.matchMedia) {
    globalThis.window
      .matchMedia('(prefers-color-scheme: dark)')
      .addEventListener('change', function (e) {
        let saved;
        try {
          saved = localStorage.getItem('repodash-theme');
        } catch {
          /* localStorage unavailable */
        }
        if (!saved) {
          applyTheme(e.matches ? 'dark' : 'light');
        }
      });
  }

  globalThis.window.addEventListener('hashchange', function () {
    const tab = globalThis.window.location.hash.replace('#', '');
    if (tab && TABS.includes(tab)) {
      switchTab(tab);
    }
  });

  setupTabListeners();

  setupModeSelect('contribution-mode', 'contributionMode', function (d) {
    if (d.contributions) {
      renderContributionChart(d.contributions, state.contributionMode, d.contributors);
    }
  });

  setupModeSelect('topcontributors-mode', 'topContributorsMode', function (d) {
    if (d.contributors) {
      renderTopContributorsChart(d.contributors, state.topContributorsMode);
    }
  });

  setupDateRangeListeners();

  setupKeyboardNav();
  setupTimeFilterKeyboardNav();

  setupContributorsSort();
  setupContributorsPagination();
}

// ═════════════════════════════════════════════════════════════════════
//  INIT
// ═════════════════════════════════════════════════════════════════════

function restoreUrlState() {
  const hashTab = globalThis.window.location.hash.replace('#', '');
  if (hashTab && TABS.includes(hashTab)) {
    state.activeTab = hashTab;
  }
  try {
    const params = new URL(globalThis.window.location.href).searchParams;
    const filterParam = params.get('filter');
    const VALID_FILTERS = ['allTime', 'pastYear', 'last3months', 'thisWeek', 'custom'];
    if (filterParam && VALID_FILTERS.includes(filterParam)) {
      state.timeFilter = filterParam;
    }
    const startParam = params.get('start');
    const endParam = params.get('end');
    if (startParam) state.customStartDate = startParam;
    if (endParam) state.customEndDate = endParam;
  } catch {
    /* ignore */
  }
}

async function init() {
  restoreUrlState();

  applyTheme(detectTheme());
  setupEvents();

  document.querySelectorAll('.pill').forEach(function (btn) {
    const isActive = btn.dataset.filter === state.timeFilter;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-checked', String(isActive));
  });

  const customRange = document.getElementById('custom-date-range');
  if (customRange) {
    customRange.classList.toggle('hidden', state.timeFilter !== 'custom');
  }
  if (document.getElementById('date-start') && state.customStartDate) {
    document.getElementById('date-start').value = state.customStartDate;
  }
  if (document.getElementById('date-end') && state.customEndDate) {
    document.getElementById('date-end').value = state.customEndDate;
  }

  syncTabUI(state.activeTab);

  initEmptyCharts(state.activeTab);

  try {
    await loadData();

    const startEl = document.getElementById('date-start');
    const endEl = document.getElementById('date-end');
    const today = getTodayLocal();
    if (startEl && state.customStartDate) {
      const clampedStart = clampDate(state.customStartDate, state.data.summary.firstCommit, today);
      state.customStartDate = clampedStart;
      startEl.value = clampedStart;
    }
    if (endEl && state.customEndDate) {
      const endClampStart = state.customStartDate || state.data.summary.firstCommit || null;
      const clampedEnd = clampDate(state.customEndDate, endClampStart, today);
      state.customEndDate = clampedEnd;
      endEl.value = clampedEnd;
    }

    if (!state.workerReady) {
      renderCurrentTab();
    }
  } catch {
    // Errors already surfaced per-tab by loadData
  }
}

if (typeof document !== 'undefined') {
  if (globalThis.window.Chart === undefined) {
    document.body.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:center;height:100vh;color:var(--red,#f85149);font-family:var(--font-sans,sans-serif);font-size:16px;padding:24px;">Failed to load Chart.js. Check your network connection.</div>';
  } else if (globalThis.window.COLORS && globalThis.window.getScaleDefaults) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  }
}

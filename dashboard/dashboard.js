/* ═════════════════════════════════════════════════════════════════════
   Insights Dashboard — Application Logic
   ═════════════════════════════════════════════════════════════════════ */

'use strict';

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
};

// ═════════════════════════════════════════════════════════════════════
//  UTILITIES
// ═════════════════════════════════════════════════════════════════════

export function formatNumber(n) {
  if (n == null || Number.isNaN(n)) return '\u2014'; // em dash
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1000000) return sign + (abs / 1000000).toFixed(1) + 'M';
  if (abs >= 1000) return sign + (abs / 1000).toFixed(1) + 'K';
  return String(n);
}

export function formatDate(iso) {
  if (!iso) return '\u2014';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function clampDate(dateStr, minStr, maxStr) {
  if (!dateStr) return dateStr;
  if (minStr && dateStr < minStr) return minStr;
  if (maxStr && dateStr > maxStr) return maxStr;
  return dateStr;
}

function getTodayLocal() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return year + '-' + month + '-' + day;
}

let _escapeDiv = null;

function escapeHtml(str) {
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
    const bounds = getCutoffDate(state.timeFilter);
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

// ── Downsample ──────────────────────────────────────────────────────

const MAX_CHART_POINTS = 500;

/**
 * Downsample an array to at most maxPoints by evenly-spaced sampling.
 * Preserves the first and last elements. Used to prevent Chart.js from
 * freezing when rendering repos with thousands of days of history.
 */
function downsampleData(arr, maxPoints) {
  if (!arr || arr.length <= maxPoints) return arr;
  const step = (arr.length - 1) / (maxPoints - 1);
  const result = [];
  for (let i = 0; i < maxPoints; i++) {
    result.push(arr[Math.round(i * step)]);
  }
  return result;
}

// ── Time filter helpers ──────────────────────────────────────────────

export function getCutoffDate(filter) {
  if (filter === 'custom') {
    return {
      start: state.customStartDate || null,
      end: state.customEndDate || null,
    };
  }
  const now = new Date();
  const d = new Date(now);
  switch (filter) {
    case 'thisWeek':
      d.setDate(now.getDate() - 7);
      break;
    case 'last3months':
      d.setMonth(now.getMonth() - 3);
      break;
    case 'pastYear':
      d.setFullYear(now.getFullYear() - 1);
      break;
    default:
      return null; // allTime
  }
  return { start: d.toISOString().slice(0, 10), end: null };
}

export function filterByDate(arr, bounds, field = 'date') {
  if (!arr?.length || !bounds) return arr;
  return arr.filter(function (item) {
    if (bounds.start && item[field] < bounds.start) return false;
    if (bounds.end && item[field] > bounds.end) return false;
    return true;
  });
}

function computeFilteredSummary(contributions, frequency) {
  const totalCommits = contributions.reduce(function (sum, d) {
    return sum + d.count;
  }, 0);
  const totalAdditions = frequency.reduce(function (sum, d) {
    return sum + d.additions;
  }, 0);
  const totalDeletions = frequency.reduce(function (sum, d) {
    return sum + d.deletions;
  }, 0);

  const authorSet = {};
  contributions.forEach(function (day) {
    (day.authorDetails || []).forEach(function (a) {
      authorSet[a.email || a.author] = true;
    });
  });
  const totalContributors = Object.keys(authorSet).length;

  let firstDate = null;
  let lastDate = null;
  for (const c of contributions) {
    if (c.date) {
      if (!firstDate || c.date < firstDate) firstDate = c.date;
      if (!lastDate || c.date > lastDate) lastDate = c.date;
    }
  }

  return {
    totalCommits: totalCommits,
    totalContributors: totalContributors,
    totalAdditions: totalAdditions,
    totalDeletions: totalDeletions,
    firstCommit: firstDate || state.data.summary.firstCommit,
    lastCommit: lastDate || state.data.summary.lastCommit,
    activeBranches: state.data.summary.activeBranches,
  };
}

export function computeFilteredContributors(contributions, allContributors) {
  const authorStats = {};
  contributions.forEach(function (day) {
    (day.authorDetails || []).forEach(function (a) {
      const key = a.email || a.author;
      if (!authorStats[key]) {
        authorStats[key] = {
          totalCommits: 0,
          additions: 0,
          deletions: 0,
        };
      }
      authorStats[key].totalCommits += a.count;
      authorStats[key].additions += a.additions;
      authorStats[key].deletions += a.deletions;
    });
  });

  return allContributors
    .filter(function (c) {
      return Object.hasOwn(authorStats, c.email);
    })
    .map(function (c) {
      const stats = authorStats[c.email] || {
        totalCommits: 0,
        additions: 0,
        deletions: 0,
      };
      return {
        name: c.name,
        email: c.email,
        totalCommits: stats.totalCommits,
        additions: stats.additions,
        deletions: stats.deletions,
        firstCommit: c.firstCommit,
        lastCommit: c.lastCommit,
      };
    })
    .sort(function (a, b) {
      return b.totalCommits - a.totalCommits || (a.name || '').localeCompare(b.name || '');
    });
}

export function computeFilteredActivity(contributions) {
  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const dayCounts = [0, 0, 0, 0, 0, 0, 0];
  const hourCounts = new Array(24).fill(0);
  const fileMap = {};

  for (const c of contributions) {
    const jsDay = new Date(c.date + 'T00:00:00Z').getUTCDay();
    const idx = (jsDay + 6) % 7;
    dayCounts[idx] += c.count;

    if (c.byHour) {
      for (let h = 0; h < c.byHour.length; h++) {
        hourCounts[h] += c.byHour[h].count;
      }
    }

    if (c.topFiles) {
      for (const f of c.topFiles) {
        fileMap[f.path] = (fileMap[f.path] || 0) + f.changes;
      }
    }
  }

  const byDayOfWeek = dayNames.map(function (day, i) {
    return { day: day, count: dayCounts[i] };
  });

  const byHour = Array.from(hourCounts, function (count, hour) {
    return { hour: hour, count: count };
  });

  const topFiles = Object.keys(fileMap)
    .map(function (path) {
      return { path: path, changes: fileMap[path] };
    })
    .sort(function (a, b) {
      return b.changes - a.changes || a.path.localeCompare(b.path);
    })
    .slice(0, 30);

  return {
    byDayOfWeek: byDayOfWeek,
    byHour: byHour,
    topFiles: topFiles,
  };
}

// ═════════════════════════════════════════════════════════════════════
//  CHART MANAGEMENT
// ═════════════════════════════════════════════════════════════════════

function lineChartOptions(frequency) {
  return {
    scales: {
      x: { maxTicksLimit: frequency.length > 90 ? 12 : undefined },
    },
    plugins: {
      legend: {
        position: 'bottom',
        labels: { boxWidth: 12, padding: 12, usePointStyle: true },
      },
    },
    interaction: { mode: 'nearest', axis: 'x', intersect: false },
  };
}

function downsampleFrequency(frequency) {
  if (!frequency || frequency.length <= MAX_CHART_POINTS) return frequency;
  return downsampleData(frequency, MAX_CHART_POINTS);
}

function renderFrequencyLineChart(frequency, chartId, alpha, pointRadius, pointHoverRadius) {
  if (!frequency?.length) {
    destroyChart(chartId);
    return;
  }

  frequency = downsampleFrequency(frequency);

  createChart(
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
          borderWidth: 2,
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
          borderWidth: 2,
        },
      ],
    },
    lineChartOptions(frequency),
  );
}

/**
 * Build a complete Chart.js options object by merging CHART_DEFAULTS,
 * theme-aware scale colors, and caller-provided overrides.  Scales
 * are deep-merged so theme ticks/grid colors flow through correctly.
 */
function buildOptions(override) {
  const D = globalThis.window.CHART_DEFAULTS;
  const theme = globalThis.window.getScaleDefaults();
  const text = globalThis.window.getTextColor();

  // Start with a shallow copy of DEFAULTS
  const opts = {};
  let key;
  for (key in D) {
    if (Object.hasOwn(D, key)) opts[key] = D[key];
  }

  // Apply top-level overrides
  if (override) {
    for (key in override) {
      if (Object.hasOwn(override, key)) opts[key] = override[key];
    }
  }

  // Deep-merge scales: DEFAULTS.scales → theme → override.scales
  const srcScales = override?.scales || {};
  opts.scales = opts.scales || {};
  opts.scales.x = { ...D.scales.x, ...theme.x, ...srcScales.x };
  opts.scales.y = { ...D.scales.y, ...theme.y, ...srcScales.y };

  // Merge plugins: override.plugins wins over DEFAULTS.plugins
  if (override?.plugins) {
    opts.plugins = { ...D.plugins, ...override.plugins };
  } else {
    opts.plugins = { ...D.plugins };
  }

  // Inject theme text color into legend labels if not explicitly set
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
    options: buildOptions(optionsOverride),
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

function showLoading(tab) {
  showElem(tab + '-loading');
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
  hideElem(tab + '-loading');
  hideElem(tab + '-error');
  hideElem(tab + '-empty');
}

function loadData() {
  return fetch('/data/all.json')
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function (data) {
      state.data = data;
      return state.data;
    })
    .catch(function (err) {
      console.error('Failed to load data:', err);
      TABS.forEach(function (t) {
        showError(
          t,
          'Failed to load dashboard data. Ensure the server is running and the repository has been analyzed.',
        );
      });
      throw err;
    });
}

// ═════════════════════════════════════════════════════════════════════
//  THEME
// ═════════════════════════════════════════════════════════════════════

function detectTheme() {
  let saved;
  try {
    saved = localStorage.getItem('insights-theme');
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
    localStorage.setItem('insights-theme', theme);
  } catch {
    /* localStorage unavailable */
  }

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute(
      'content',
      getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
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

  renderCurrentTab();
}

function setTimeFilter(filter) {
  if (state.timeFilter === filter && filter !== 'custom') return;
  state.timeFilter = filter;

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
    btn.classList.toggle('active', btn.dataset.filter === filter);
  });

  const customRange = document.getElementById('custom-date-range');
  if (customRange) {
    customRange.classList.toggle('hidden', filter !== 'custom');
  }

  renderCurrentTab();
}

function getFilteredData() {
  if (!state.data) return null;
  const bounds = getCutoffDate(state.timeFilter);

  const filteredContributions = filterByDate(state.data.contributions, bounds);
  const filteredFrequency = filterByDate(state.data.frequency, bounds);

  const filteredSummary = computeFilteredSummary(filteredContributions, filteredFrequency);
  const filteredContributors = computeFilteredContributors(
    filteredContributions,
    state.data.contributors,
  );

  return {
    summary: filteredSummary,
    contributions: filteredContributions,
    contributors: filteredContributors,
    frequency: filteredFrequency,
    activity: computeFilteredActivity(filteredContributions),
  };
}

function renderCurrentTab() {
  if (!state.data) return;
  const d = getFilteredData();
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
}

// ═════════════════════════════════════════════════════════════════════
//  OVERVIEW TAB
// ═════════════════════════════════════════════════════════════════════

function renderOverview(d) {
  clearStates('overview');

  document.getElementById('metric-commits').textContent = formatNumber(d.summary.totalCommits);
  document.getElementById('metric-contributors').textContent = formatNumber(
    d.summary.totalContributors,
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

  renderContributionChart(d.contributions, d.frequency, state.contributionMode, d.contributors);
  renderTopContributorsChart(d.contributors, state.topContributorsMode);
  renderFrequencyOverviewChart(d.frequency);
}

// -- Contribution chart (multi-mode) -----------------------------------

function renderContributionChart(contributions, frequency, mode, contributors) {
  if (!contributions?.length) return;
  mode = mode || 'author';

  if (mode === 'commits') {
    renderContributionCommits(contributions);
  } else if (mode === 'lines') {
    renderContributionLines(frequency);
  } else {
    renderContributionAuthor(contributions, contributors);
  }
}

function downsampleContributions(contributions) {
  if (!contributions || contributions.length <= MAX_CHART_POINTS) return contributions;
  return downsampleData(contributions, MAX_CHART_POINTS);
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
    borderRadius: 2,
  };
}

function renderContributionAuthor(contributions, contributors) {
  contributions = downsampleContributions(contributions);
  const TOP = 10;
  const seen = {};
  const authorKeys = [];
  (contributors || []).forEach(function (c) {
    const key = c.name || c.email;
    if (!seen[key]) {
      seen[key] = true;
      authorKeys.push({ key: key, label: key });
    }
  });
  const topAuthors = authorKeys.slice(0, TOP);
  const hasOthers = authorKeys.length > TOP;

  // Build a lookup from key -> { date -> count }
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
      borderRadius: 2,
    });
  });

  if (hasOthers) {
    const othersDataset = buildOthersDataset(contributions, topAuthors);
    if (othersDataset) datasets.push(othersDataset);
  }

  createChart(
    'chart-contribution',
    'bar',
    {
      labels: contributions.map(function (d) {
        return d.date;
      }),
      datasets: datasets,
    },
    {
      scales: {
        x: {
          stacked: true,
          maxTicksLimit: contributions.length > 90 ? 12 : undefined,
        },
        y: {
          stacked: true,
          title: { display: true, text: 'Commits' },
        },
      },
      plugins: {
        legend: {
          display: true,
          position: 'bottom',
          labels: { boxWidth: 12, padding: 12 },
        },
      },
    },
  );
}

function renderContributionCommits(contributions) {
  const display = downsampleContributions(contributions);
  createChart(
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
          borderRadius: 2,
        },
      ],
    },
    {
      scales: {
        x: {
          stacked: false,
          maxTicksLimit: display.length > 90 ? 12 : undefined,
        },
        y: {
          stacked: false,
          beginAtZero: true,
          title: { display: true, text: 'Commits' },
        },
      },
      plugins: {
        legend: { display: false },
      },
    },
  );
}

function renderContributionLines(frequency) {
  renderFrequencyLineChart(frequency, 'chart-contribution', '20', 0, undefined);
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

  createChart(
    'chart-top-contributors',
    'bar',
    {
      labels: top.map(function (c) {
        return c.name || c.email;
      }),
      datasets: [
        {
          label: label,
          data: data,
          backgroundColor: globalThis.window.COLORS.blue,
          borderWidth: 0,
          borderRadius: 2,
        },
      ],
    },
    {
      indexAxis: 'y',
      scales: {
        x: { beginAtZero: true },
        y: { grid: { display: false } },
      },
      plugins: { legend: { display: false }, tooltip: { mode: 'y', intersect: false } },
    },
  );
}

// -- Code frequency overview chart -----------------------------------

function renderFrequencyOverviewChart(frequency) {
  renderFrequencyLineChart(
    frequency,
    'chart-frequency-overview',
    '30',
    frequency.length < 60 ? 2 : 0,
    4,
  );
}

// ═════════════════════════════════════════════════════════════════════
//  CONTRIBUTORS TAB
// ═════════════════════════════════════════════════════════════════════

function renderContributorsTable(contributors) {
  const tbody = document.querySelector('#contributors-table tbody');
  tbody.innerHTML = '';
  contributors.forEach(function (c) {
    const tr = document.createElement('tr');
    tr.innerHTML =
      '<td>' +
      escapeHtml(c.name || c.email) +
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

function renderContributorBarChart(contributors) {
  const barHeight = 14;
  const maxChartHeight = 560;
  const maxBars = Math.floor(maxChartHeight / barHeight);
  const list = contributors.slice(0, maxBars).reverse();
  const chartHeight = Math.max(320, list.length * barHeight);

  const wrap = document.getElementById('chart-contributor-distribution').parentElement;
  wrap.style.height = chartHeight + 'px';

  createChart(
    'chart-contributor-distribution',
    'bar',
    {
      labels: list.map(function (c) {
        return c.name || c.email;
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
          barThickness: 12,
        },
      ],
    },
    {
      indexAxis: 'y',
      scales: {
        y: {
          ticks: { font: { size: 11 }, autoSkip: false },
          grid: { display: false },
        },
        x: { beginAtZero: true },
      },
      plugins: { legend: { display: false }, tooltip: { mode: 'y', intersect: false } },
    },
  );
}

function renderContributors(d) {
  clearStates('contributors');
  if (!d.contributors?.length) {
    destroyChart('chart-contributor-distribution');
    showEmpty('contributors');
    return;
  }

  renderContributorsTable(d.contributors);
  renderContributorBarChart(d.contributors);
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
  createChart(
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
          borderRadius: 2,
        },
      ],
    },
    { plugins: { legend: { display: false } } },
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
    },
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
    const debouncedRender = debounce(function () {
      if (state.activeTab === 'overview') {
        const d = getFilteredData();
        if (d) renderFn(d);
      }
    }, 300);
    el.addEventListener('change', function () {
      state[stateKey] = el.value;
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

function setupDateRangeListeners() {
  const dateStart = document.getElementById('date-start');
  const dateEnd = document.getElementById('date-end');
  if (dateStart) {
    dateStart.addEventListener('input', function () {
      const val = dateStart.value;
      if (val.length !== 10) {
        if (state.customStartDate !== null) {
          state.customStartDate = null;
        }
        return;
      }
      const today = getTodayLocal();
      const min = state.data?.summary ? state.data.summary.firstCommit : null;
      const date = clampDate(val, min, today);
      state.customStartDate = date;
      dateStart.value = date || '';
      if (date && state.customEndDate && state.customEndDate < date) {
        state.customEndDate = clampDate(date, null, today);
        if (dateEnd) dateEnd.value = state.customEndDate;
      }
      setTimeFilter('custom');
    });
  }
  if (dateEnd) {
    dateEnd.addEventListener('input', function () {
      const val = dateEnd.value;
      if (val.length !== 10) {
        if (state.customEndDate !== null) {
          state.customEndDate = null;
        }
        return;
      }
      const today = getTodayLocal();
      const min = state.customStartDate || null;
      const date = clampDate(val, min, today);
      state.customEndDate = date;
      dateEnd.value = date || '';
      setTimeFilter('custom');
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
  exportBtn.addEventListener('click', async function () {
    const filtered = getFilteredData();
    if (!filtered?.contributions?.length) return;

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
    (() => document.body.offsetHeight)();
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
        if (globalThis.window.NOTO_SANS_MULTILANGUAGE_BASE64) {
          pdf.addFileToVFS(
            'noto-sans-multilanguage.ttf',
            globalThis.window.NOTO_SANS_MULTILANGUAGE_BASE64,
          );
          pdf.addFont('noto-sans-multilanguage.ttf', 'NotoSansMultilanguage', 'normal');
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
            logging: false,
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
            align: 'right',
          });
        };
      }

      const tableBase = {
        margin: { top: margin, bottom: margin },
        tableWidth: 'auto',
        showHead: 'everyPage',
        didDrawPage: pageFooter(pdf, pageWidth, margin, pageHeight),
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

      const contributors = filtered.contributors;
      if (contributors?.length) {
        pdf.autoTable({
          head: [['Name', 'Commits', 'Additions', 'Deletions', 'First Commit', 'Last Commit']],
          body: contributors.map(function (c) {
            return [
              c.name || c.email,
              formatNumber(c.totalCommits),
              formatNumber(c.additions),
              formatNumber(c.deletions),
              formatDate(c.firstCommit),
              formatDate(c.lastCommit),
            ];
          }),
          startY: y,
          styles: { fontSize: 7, cellPadding: 2, font: unicodeFont, fontStyle: 'normal' },
          headStyles: {
            fillColor: [88, 166, 255],
            fontSize: 8,
            font: unicodeFont,
            fontStyle: 'normal',
          },
          alternateRowStyles: { fillColor: [245, 247, 250] },
          columnStyles: {
            1: { halign: 'center' },
            2: { halign: 'center' },
            3: { halign: 'center' },
          },
          didParseCell: function (data) {
            if (
              data.section === 'head' &&
              (data.column.index === 1 || data.column.index === 2 || data.column.index === 3)
            ) {
              data.cell.styles.halign = 'center';
            }
          },
          ...tableBase,
        });
        y = pdf.lastAutoTable.finalY + 10;
      }

      const otherCharts = Array.from(
        document.querySelectorAll('#tab-contributors .chart-card, #tab-activity .chart-card'),
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
          ...tableBase,
        });
        y = pdf.lastAutoTable.finalY + 10;
      }

      const fileSafeName = dateLabel
        .replace(/[^a-zA-Z0-9]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
      pdf.save((repoName || 'insights') + '-' + fileSafeName + '.pdf');
    } catch (err) {
      console.error('PDF generation failed:', err);
      exportBtn.classList.add('export-error');
      setTimeout(function () {
        exportBtn.classList.remove('export-error');
      }, 3000);
    } finally {
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
          saved = localStorage.getItem('insights-theme');
        } catch {
          /* localStorage unavailable */
        }
        if (!saved) {
          applyTheme(e.matches ? 'dark' : 'light');
        }
      });
  }

  // Sync tab from URL hash on browser back/forward
  globalThis.window.addEventListener('hashchange', function () {
    const tab = globalThis.window.location.hash.replace('#', '');
    if (tab && TABS.includes(tab)) {
      switchTab(tab);
    }
  });

  setupTabListeners();

  setupModeSelect('contribution-mode', 'contributionMode', function (d) {
    if (d.contributions) {
      renderContributionChart(d.contributions, d.frequency, state.contributionMode, d.contributors);
    }
  });

  setupModeSelect('topcontributors-mode', 'topContributorsMode', function (d) {
    if (d.contributors) {
      renderTopContributorsChart(d.contributors, state.topContributorsMode);
    }
  });

  setupDateRangeListeners();

  setupKeyboardNav();
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
    if (filterParam && getCutoffDate(filterParam) !== undefined) {
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

function init() {
  restoreUrlState();

  applyTheme(detectTheme());
  setupEvents();

  // Sync active pill state with loaded timeFilter
  document.querySelectorAll('.pill').forEach(function (btn) {
    btn.classList.toggle('active', btn.dataset.filter === state.timeFilter);
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

  // Sync active tab state with loaded activeTab
  syncTabUI(state.activeTab);

  TABS.forEach(function (t) {
    showLoading(t);
  });

  loadData()
    .then(function () {
      // Clamp custom dates restored from URL params
      const startEl = document.getElementById('date-start');
      const endEl = document.getElementById('date-end');
      const today = getTodayLocal();
      if (startEl && state.customStartDate) {
        const clampedStart = clampDate(
          state.customStartDate,
          state.data.summary.firstCommit,
          today,
        );
        state.customStartDate = clampedStart;
        startEl.value = clampedStart;
      }
      if (endEl && state.customEndDate) {
        const endClampStart = state.customStartDate || state.data.summary.firstCommit || null;
        const clampedEnd = clampDate(state.customEndDate, endClampStart, today);
        state.customEndDate = clampedEnd;
        endEl.value = clampedEnd;
      }

      TABS.forEach(function (t) {
        clearStates(t);
      });
      renderCurrentTab();
    })
    .catch(function () {
      // Errors already surfaced per-tab by loadData
    });
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

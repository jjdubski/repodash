/* ═════════════════════════════════════════════════════════════════════
   Insights Dashboard — Application Logic
   ═════════════════════════════════════════════════════════════════════ */

(function () {
  "use strict";

  // ── Guard ────────────────────────────────────────────────────────────
  if (typeof Chart === "undefined") {
    document.body.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:center;height:100vh;color:var(--red,#f85149);font-family:var(--font-sans,sans-serif);font-size:16px;padding:24px;">Failed to load Chart.js. Check your network connection.</div>';
    return;
  }
  if (!window.COLORS || !window.getScaleDefaults) return; // config didn't load

  // ── State ───────────────────────────────────────────────────────────
  var state = {
    data: null,
    activeTab: "overview",
    timeFilter: "last3months",
    theme: "light",
    charts: {},
    customStartDate: null,
    customEndDate: null,
    contributionMode: "author",
    topContributorsMode: "commits",
  };

  // ═════════════════════════════════════════════════════════════════════
  //  UTILITIES
  // ═════════════════════════════════════════════════════════════════════

  function formatNumber(n) {
    if (n == null || isNaN(n)) return "\u2014"; // em dash
    var abs = Math.abs(n);
    var sign = n < 0 ? "-" : "";
    if (abs >= 1000000) return sign + (abs / 1000000).toFixed(1) + "M";
    if (abs >= 1000) return sign + (abs / 1000).toFixed(1) + "K";
    return String(n);
  }

  function formatDate(iso) {
    if (!iso) return "\u2014";
    try {
      return new Date(iso).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch (_) {
      return iso.slice(0, 10);
    }
  }

  var _escapeDiv = null;

  function escapeHtml(str) {
    if (!_escapeDiv) _escapeDiv = document.createElement("div");
    _escapeDiv.textContent = str;
    return _escapeDiv.innerHTML;
  }

  // ── Time filter helpers ──────────────────────────────────────────────

  function getCutoffDate(filter) {
    if (filter === "custom") {
      return {
        start: state.customStartDate || null,
        end: state.customEndDate || null,
      };
    }
    var now = new Date();
    var d = new Date(now);
    switch (filter) {
      case "thisWeek":
        d.setDate(now.getDate() - 7);
        break;
      case "last3months":
        d.setMonth(now.getMonth() - 3);
        break;
      case "pastYear":
        d.setFullYear(now.getFullYear() - 1);
        break;
      default:
        return null; // allTime
    }
    return { start: d.toISOString().slice(0, 10), end: null };
  }

  function filterByDate(arr, bounds, field) {
    if (!arr || !arr.length || !bounds) return arr;
    field = field || "date";
    return arr.filter(function (item) {
      if (bounds.start && item[field] < bounds.start) return false;
      if (bounds.end && item[field] > bounds.end) return false;
      return true;
    });
  }

  function computeFilteredSummary(contributions, frequency) {
    var totalCommits = contributions.reduce(function (sum, d) {
      return sum + d.count;
    }, 0);
    var totalAdditions = frequency.reduce(function (sum, d) {
      return sum + d.additions;
    }, 0);
    var totalDeletions = frequency.reduce(function (sum, d) {
      return sum + d.deletions;
    }, 0);

    var authorSet = {};
    contributions.forEach(function (day) {
      (day.authorDetails || []).forEach(function (a) {
        authorSet[a.email || a.author] = true;
      });
    });
    var totalContributors = Object.keys(authorSet).length;

    return {
      totalCommits: totalCommits,
      totalContributors: totalContributors,
      totalAdditions: totalAdditions,
      totalDeletions: totalDeletions,
      firstCommit: state.data.summary.firstCommit,
      lastCommit: state.data.summary.lastCommit,
      activeBranches: state.data.summary.activeBranches,
    };
  }

  function computeFilteredContributors(contributions, allContributors) {
    var authorStats = {};
    contributions.forEach(function (day) {
      (day.authorDetails || []).forEach(function (a) {
        var key = a.email || a.author;
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
        return authorStats.hasOwnProperty(c.email);
      })
      .map(function (c) {
        var stats = authorStats[c.email] || {
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
        return (
          b.totalCommits - a.totalCommits ||
          (a.name || "").localeCompare(b.name || "")
        );
      });
  }

  // ═════════════════════════════════════════════════════════════════════
  //  CHART MANAGEMENT
  // ═════════════════════════════════════════════════════════════════════

  /**
   * Build a complete Chart.js options object by merging CHART_DEFAULTS,
   * theme-aware scale colours, and caller-provided overrides.  Scales
   * are deep-merged so theme ticks/grid colours flow through correctly.
   */
  function buildOptions(override) {
    var D = window.CHART_DEFAULTS;
    var theme = window.getScaleDefaults();
    var text = window.getTextColor();

    // Start with a shallow copy of DEFAULTS
    var opts = {};
    var key;
    for (key in D) {
      if (D.hasOwnProperty(key)) opts[key] = D[key];
    }

    // Apply top-level overrides
    if (override) {
      for (key in override) {
        if (override.hasOwnProperty(key)) opts[key] = override[key];
      }
    }

    // Deep-merge scales: DEFAULTS.scales → theme → override.scales
    var srcScales = (override && override.scales) || {};
    opts.scales = opts.scales || {};
    opts.scales.x = Object.assign({}, D.scales.x, theme.x, srcScales.x || {});
    opts.scales.y = Object.assign({}, D.scales.y, theme.y, srcScales.y || {});

    // Merge plugins: override.plugins wins over DEFAULTS.plugins
    if (override && override.plugins) {
      opts.plugins = Object.assign({}, D.plugins, override.plugins);
    } else {
      opts.plugins = Object.assign({}, D.plugins);
    }

    // Inject theme text colour into legend labels if not explicitly set
    if (opts.plugins.legend && !opts.plugins.legend.labels) {
      opts.plugins.legend.labels = { color: text };
    } else if (
      opts.plugins.legend &&
      opts.plugins.legend.labels &&
      !opts.plugins.legend.labels.color
    ) {
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
    var canvas = document.getElementById(id);
    if (!canvas) return null;
    var ctx = canvas.getContext("2d");
    state.charts[id] = new Chart(ctx, {
      type: type,
      data: data,
      options: buildOptions(optionsOverride),
    });
    return state.charts[id];
  }

  /**
   * After a theme change, update all existing chart instances to use
   * the new colour scheme.  We rebuild the scale/legend config and
   * call chart.update('none') so no animation replays.
   */
  function updateAllChartColors() {
    var theme = window.getScaleDefaults();
    var text = window.getTextColor();
    Object.keys(state.charts).forEach(function (id) {
      var chart = state.charts[id];
      if (!chart) return;

      var scales = chart.options.scales || {};
      if (scales.x) {
        scales.x.ticks = scales.x.ticks || {};
        scales.x.ticks.color = theme.x.ticks.color;
      }
      if (scales.y) {
        scales.y.ticks = scales.y.ticks || {};
        scales.y.ticks.color = theme.y.ticks.color;
        scales.y.grid = scales.y.grid || {};
        scales.y.grid.color = theme.y.grid.color;
      }

      var plugins = chart.options.plugins || {};
      if (plugins.legend && plugins.legend.labels) {
        plugins.legend.labels.color = text;
      }

      chart.update("none");
    });
  }

  // ═════════════════════════════════════════════════════════════════════
  //  DATA LOADING & STATE MESSAGES
  // ═════════════════════════════════════════════════════════════════════

  var TABS = ["overview", "contributors", "codefrequency", "activity"];

  function showElem(id) {
    var e = document.getElementById(id);
    if (e) e.classList.remove("hidden");
  }
  function hideElem(id) {
    var e = document.getElementById(id);
    if (e) e.classList.add("hidden");
  }

  function showLoading(tab) {
    showElem(tab + "-loading");
  }
  function hideLoading(tab) {
    hideElem(tab + "-loading");
  }
  function showError(tab, msg) {
    var el = document.getElementById(tab + "-error");
    if (el) {
      el.textContent = msg;
      showElem(tab + "-error");
    }
  }
  function showEmpty(tab) {
    showElem(tab + "-empty");
  }

  function clearStates(tab) {
    hideElem(tab + "-loading");
    hideElem(tab + "-error");
    hideElem(tab + "-empty");
  }

  function loadData() {
    var fetches = [
      fetch("/data/summary.json").then(function (r) {
        return r.json();
      }),
      fetch("/data/contributions.json").then(function (r) {
        return r.json();
      }),
      fetch("/data/contributors.json").then(function (r) {
        return r.json();
      }),
      fetch("/data/frequency.json").then(function (r) {
        return r.json();
      }),
      fetch("/data/activity.json").then(function (r) {
        return r.json();
      }),
    ];

    return Promise.all(fetches)
      .then(function (results) {
        state.data = {
          summary: results[0],
          contributions: results[1],
          contributors: results[2],
          frequency: results[3],
          activity: results[4],
        };
        return state.data;
      })
      .catch(function (err) {
        console.error("Failed to load data:", err);
        TABS.forEach(function (t) {
          showError(
            t,
            "Failed to load dashboard data. Ensure the server is running and the repository has been analyzed.",
          );
        });
        throw err;
      });
  }

  // ═════════════════════════════════════════════════════════════════════
  //  THEME
  // ═════════════════════════════════════════════════════════════════════

  function detectTheme() {
    var saved = localStorage.getItem("insights-theme");
    if (saved === "dark" || saved === "light") return saved;
    if (
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
    ) {
      return "dark";
    }
    return "light";
  }

  function applyTheme(theme) {
    state.theme = theme;
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("insights-theme", theme);

    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute(
        "content",
        getComputedStyle(document.documentElement)
          .getPropertyValue("--bg")
          .trim(),
      );
    }
    updateAllChartColors();
  }

  function toggleTheme() {
    applyTheme(state.theme === "dark" ? "light" : "dark");
  }

  // ═════════════════════════════════════════════════════════════════════
  //  TAB SWITCHING & TIME FILTER
  // ═════════════════════════════════════════════════════════════════════

  function switchTab(tabName) {
    if (state.activeTab === tabName) return;
    state.activeTab = tabName;

    window.location.hash = tabName;

    document.querySelectorAll(".tab").forEach(function (btn) {
      var match = btn.getAttribute("data-tab") === tabName;
      btn.classList.toggle("active", match);
      btn.setAttribute("aria-selected", String(match));
    });

    document.querySelectorAll(".tab-content").forEach(function (sec) {
      sec.classList.toggle("active", sec.id === "tab-" + tabName);
    });

    renderCurrentTab();
  }

  function setTimeFilter(filter) {
    if (state.timeFilter === filter) return;
    state.timeFilter = filter;

    try {
      var url = new URL(window.location.href);
      url.searchParams.set("filter", filter);
      if (filter === "custom") {
        if (state.customStartDate)
          url.searchParams.set("start", state.customStartDate);
        else url.searchParams.delete("start");
        if (state.customEndDate)
          url.searchParams.set("end", state.customEndDate);
        else url.searchParams.delete("end");
      }
      window.history.replaceState(null, "", url);
    } catch (_) {
      /* ignore */
    }

    document.querySelectorAll(".pill").forEach(function (btn) {
      btn.classList.toggle(
        "active",
        btn.getAttribute("data-filter") === filter,
      );
    });

    var customRange = document.getElementById("custom-date-range");
    if (customRange) {
      customRange.classList.toggle("hidden", filter !== "custom");
    }

    renderCurrentTab();
  }

  function getFilteredData() {
    if (!state.data) return null;
    var bounds = getCutoffDate(state.timeFilter);

    var filteredContributions = filterByDate(state.data.contributions, bounds);
    var filteredFrequency = filterByDate(state.data.frequency, bounds);

    var filteredSummary = computeFilteredSummary(
      filteredContributions,
      filteredFrequency,
    );
    var filteredContributors = computeFilteredContributors(
      filteredContributions,
      state.data.contributors,
    );

    return {
      summary: filteredSummary,
      contributions: filteredContributions,
      contributors: filteredContributors,
      frequency: filteredFrequency,
      activity: state.data.activity,
    };
  }

  function renderCurrentTab() {
    if (!state.data) return;
    var d = getFilteredData();
    switch (state.activeTab) {
      case "overview":
        renderOverview(d);
        break;
      case "contributors":
        renderContributors(d);
        break;
      case "codefrequency":
        renderCodeFrequency(d);
        break;
      case "activity":
        renderActivity(d);
        break;
    }
  }

  // ═════════════════════════════════════════════════════════════════════
  //  OVERVIEW TAB
  // ═════════════════════════════════════════════════════════════════════

  function renderOverview(d) {
    clearStates("overview");

    document.getElementById("metric-commits").textContent = formatNumber(
      d.summary.totalCommits,
    );
    document.getElementById("metric-contributors").textContent = formatNumber(
      d.summary.totalContributors,
    );
    document.getElementById("metric-additions").textContent = formatNumber(
      d.summary.totalAdditions,
    );
    document.getElementById("metric-deletions").textContent = formatNumber(
      d.summary.totalDeletions,
    );

    if (!d.contributions || !d.contributions.length) {
      showEmpty("overview");
      return;
    }

    renderContributionChart(
      d.contributions,
      d.frequency,
      state.contributionMode,
      d.contributors,
    );
    renderTopContributorsChart(d.contributors, state.topContributorsMode);
    renderFrequencyMiniChart(d.frequency);
  }

  // -- Contribution chart (multi-mode) -----------------------------------

  function renderContributionChart(
    contributions,
    frequency,
    mode,
    contributors,
  ) {
    if (!contributions || !contributions.length) return;
    mode = mode || "author";

    if (mode === "commits") {
      renderContributionCommits(contributions);
    } else if (mode === "lines") {
      renderContributionLines(frequency);
    } else {
      renderContributionAuthor(contributions, contributors);
    }
  }

  function renderContributionAuthor(contributions, contributors) {
    var TOP = 7;
    var seen = {};
    var authorKeys = [];
    (contributors || []).forEach(function (c) {
      var key = c.name || c.email;
      if (!seen[key]) {
        seen[key] = true;
        authorKeys.push({ key: key, label: key });
      }
    });
    var topAuthors = authorKeys.slice(0, TOP);
    var hasOthers = authorKeys.length > TOP;

    // Build a lookup from key -> { date -> count }
    var authorDayIndex = {};
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

    var datasets = [];
    topAuthors.forEach(function (a, i) {
      var lookup = authorDayIndex[a.key] || {};
      datasets.push({
        label: a.label,
        data: contributions.map(function (day) {
          return lookup[day.date] || 0;
        }),
        backgroundColor: window.COLOR_LIST[i % window.COLOR_LIST.length],
        borderWidth: 0,
        borderRadius: 2,
      });
    });

    if (hasOthers) {
      var topSet = {};
      topAuthors.forEach(function (x) {
        topSet[x.key] = true;
      });
      datasets.push({
        label: "Others",
        data: contributions.map(function (day) {
          var sum = 0;
          (day.authorDetails || []).forEach(function (a) {
            if (!topSet[a.author]) sum += a.count;
          });
          return sum;
        }),
        backgroundColor: "#8b949e",
        borderWidth: 0,
        borderRadius: 2,
      });
    }

    createChart(
      "chart-contribution",
      "bar",
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
            title: { display: true, text: "Commits" },
          },
        },
        plugins: {
          legend: {
            display: true,
            position: "bottom",
            labels: { boxWidth: 12, padding: 12 },
          },
        },
      },
    );
  }

  function renderContributionCommits(contributions) {
    createChart(
      "chart-contribution",
      "bar",
      {
        labels: contributions.map(function (d) {
          return d.date;
        }),
        datasets: [
          {
            label: "Commits",
            data: contributions.map(function (d) {
              return d.count;
            }),
            backgroundColor: window.COLORS.blue,
            borderWidth: 0,
            borderRadius: 2,
          },
        ],
      },
      {
        scales: {
          x: {
            stacked: false,
            maxTicksLimit: contributions.length > 90 ? 12 : undefined,
          },
          y: {
            stacked: false,
            beginAtZero: true,
            title: { display: true, text: "Commits" },
          },
        },
        plugins: {
          legend: { display: false },
        },
      },
    );
  }

  function renderContributionLines(frequency) {
    if (!frequency || !frequency.length) {
      destroyChart("chart-contribution");
      return;
    }

    createChart(
      "chart-contribution",
      "line",
      {
        labels: frequency.map(function (d) {
          return d.date;
        }),
        datasets: [
          {
            label: "Additions",
            data: frequency.map(function (d) {
              return d.additions;
            }),
            borderColor: window.COLORS.green,
            backgroundColor: window.COLORS.green + "20",
            fill: true,
            tension: 0.3,
            pointRadius: 0,
            borderWidth: 2,
          },
          {
            label: "Deletions",
            data: frequency.map(function (d) {
              return d.deletions;
            }),
            borderColor: window.COLORS.red,
            backgroundColor: window.COLORS.red + "20",
            fill: true,
            tension: 0.3,
            pointRadius: 0,
            borderWidth: 2,
          },
        ],
      },
      {
        scales: {
          x: { maxTicksLimit: frequency.length > 90 ? 12 : undefined },
        },
        plugins: {
          legend: {
            position: "bottom",
            labels: { boxWidth: 12, padding: 12, usePointStyle: true },
          },
        },
        interaction: { mode: "nearest", axis: "x", intersect: false },
      },
    );
  }

  // -- Top contributors horizontal bar -----------------------------------

  function renderTopContributorsChart(contributors, mode) {
    if (!contributors || !contributors.length) return;
    mode = mode || "commits";
    var top10 = contributors.slice(0, 10);

    var label, data;
    if (mode === "additions") {
      label = "Additions";
      data = top10.map(function (c) {
        return c.additions;
      });
    } else if (mode === "deletions") {
      label = "Deletions";
      data = top10.map(function (c) {
        return c.deletions;
      });
    } else {
      label = "Commits";
      data = top10.map(function (c) {
        return c.totalCommits;
      });
    }

    createChart(
      "chart-top-contributors",
      "bar",
      {
        labels: top10.map(function (c) {
          return c.name || c.email;
        }),
        datasets: [
          {
            label: label,
            data: data,
            backgroundColor: window.COLORS.blue,
            borderWidth: 0,
            borderRadius: 2,
          },
        ],
      },
      {
        indexAxis: "y",
        scales: {
          x: { beginAtZero: true },
          y: { grid: { display: false } },
        },
        plugins: { legend: { display: false } },
      },
    );
  }

  // -- Code frequency mini area chart ------------------------------------

  function renderFrequencyMiniChart(frequency) {
    if (!frequency || !frequency.length) return;

    createChart(
      "chart-frequency-mini",
      "line",
      {
        labels: frequency.map(function (d) {
          return d.date;
        }),
        datasets: [
          {
            label: "Additions",
            data: frequency.map(function (d) {
              return d.additions;
            }),
            borderColor: window.COLORS.green,
            backgroundColor: window.COLORS.green + "20",
            fill: true,
            tension: 0.3,
            pointRadius: 0,
            borderWidth: 2,
          },
          {
            label: "Deletions",
            data: frequency.map(function (d) {
              return d.deletions;
            }),
            borderColor: window.COLORS.red,
            backgroundColor: window.COLORS.red + "20",
            fill: true,
            tension: 0.3,
            pointRadius: 0,
            borderWidth: 2,
          },
        ],
      },
      {
        scales: {
          x: { maxTicksLimit: frequency.length > 60 ? 8 : undefined },
        },
        plugins: {
          legend: {
            position: "bottom",
            labels: { boxWidth: 12, padding: 12, usePointStyle: true },
          },
        },
        interaction: { mode: "nearest", axis: "x", intersect: false },
      },
    );
  }

  // ═════════════════════════════════════════════════════════════════════
  //  CONTRIBUTORS TAB
  // ═════════════════════════════════════════════════════════════════════

  function renderContributors(d) {
    clearStates("contributors");
    if (!d.contributors || !d.contributors.length) {
      showEmpty("contributors");
      return;
    }

    // -- Table --
    var tbody = document.querySelector("#contributors-table tbody");
    tbody.innerHTML = "";
    d.contributors.forEach(function (c) {
      var tr = document.createElement("tr");
      tr.innerHTML =
        "<td>" +
        escapeHtml(c.name || c.email) +
        "</td>" +
        '<td class="num-col">' +
        formatNumber(c.totalCommits) +
        "</td>" +
        '<td class="num-col">' +
        formatNumber(c.additions) +
        "</td>" +
        '<td class="num-col">' +
        formatNumber(c.deletions) +
        "</td>" +
        "<td>" +
        formatDate(c.firstCommit) +
        "</td>" +
        "<td>" +
        formatDate(c.lastCommit) +
        "</td>";
      tbody.appendChild(tr);
    });

    // -- Distribution bar chart (all contributors, reversed so top is first) --
    var list = d.contributors.slice().reverse();

    createChart(
      "chart-contributor-distribution",
      "bar",
      {
        labels: list.map(function (c) {
          return c.name || c.email;
        }),
        datasets: [
          {
            label: "Commits",
            data: list.map(function (c) {
              return c.totalCommits;
            }),
            backgroundColor: list.map(function (_, i) {
              return window.COLOR_LIST[i % window.COLOR_LIST.length];
            }),
            borderWidth: 0,
            borderRadius: 2,
          },
        ],
      },
      {
        indexAxis: "y",
        scales: {
          y: { ticks: { font: { size: 11 } }, grid: { display: false } },
        },
        plugins: { legend: { display: false } },
      },
    );
  }

  // ═════════════════════════════════════════════════════════════════════
  //  CODE FREQUENCY TAB
  // ═════════════════════════════════════════════════════════════════════

  function renderCodeFrequency(d) {
    clearStates("codefrequency");
    if (!d.frequency || !d.frequency.length) {
      showEmpty("codefrequency");
      return;
    }

    var freq = d.frequency;
    createChart(
      "chart-frequency",
      "line",
      {
        labels: freq.map(function (x) {
          return x.date;
        }),
        datasets: [
          {
            label: "Additions",
            data: freq.map(function (x) {
              return x.additions;
            }),
            borderColor: window.COLORS.green,
            backgroundColor: window.COLORS.green + "30",
            fill: true,
            tension: 0.3,
            pointRadius: freq.length < 60 ? 2 : 0,
            pointHoverRadius: 4,
            borderWidth: 2,
          },
          {
            label: "Deletions",
            data: freq.map(function (x) {
              return x.deletions;
            }),
            borderColor: window.COLORS.red,
            backgroundColor: window.COLORS.red + "30",
            fill: true,
            tension: 0.3,
            pointRadius: freq.length < 60 ? 2 : 0,
            pointHoverRadius: 4,
            borderWidth: 2,
          },
        ],
      },
      {
        scales: {
          x: { maxTicksLimit: freq.length > 90 ? 12 : undefined },
        },
        plugins: {
          legend: {
            position: "bottom",
            labels: { boxWidth: 12, padding: 12, usePointStyle: true },
          },
        },
        interaction: { mode: "nearest", axis: "x", intersect: false },
      },
    );
  }

  // ═════════════════════════════════════════════════════════════════════
  //  ACTIVITY TAB
  // ═════════════════════════════════════════════════════════════════════

  function renderActivity(d) {
    clearStates("activity");
    var a = d.activity;
    if (!a) {
      showEmpty("activity");
      return;
    }

    var hasWeek =
      a.byDayOfWeek &&
      a.byDayOfWeek.some(function (x) {
        return x.count > 0;
      });
    var hasHour =
      a.byHour &&
      a.byHour.some(function (x) {
        return x.count > 0;
      });
    var hasFiles = a.topFiles && a.topFiles.length > 0;

    if (!hasWeek && !hasHour && !hasFiles) {
      showEmpty("activity");
      return;
    }

    // Day-of-week bar chart
    if (a.byDayOfWeek && a.byDayOfWeek.length) {
      createChart(
        "chart-dayofweek",
        "bar",
        {
          labels: a.byDayOfWeek.map(function (x) {
            return x.day;
          }),
          datasets: [
            {
              label: "Commits",
              data: a.byDayOfWeek.map(function (x) {
                return x.count;
              }),
              backgroundColor: window.COLORS.purple,
              borderWidth: 0,
              borderRadius: 2,
            },
          ],
        },
        {
          plugins: { legend: { display: false } },
        },
      );
    }

    // Hour-of-day bar chart
    if (a.byHour && a.byHour.length) {
      createChart(
        "chart-hour",
        "bar",
        {
          labels: a.byHour.map(function (x) {
            return String(x.hour).padStart(2, "0") + ":00";
          }),
          datasets: [
            {
              label: "Commits",
              data: a.byHour.map(function (x) {
                return x.count;
              }),
              backgroundColor: window.COLORS.orange,
              borderWidth: 0,
              borderRadius: 2,
            },
          ],
        },
        {
          plugins: { legend: { display: false } },
        },
      );
    }

    // Top files table
    if (a.topFiles && a.topFiles.length) {
      var tbody = document.querySelector("#topfiles-table tbody");
      tbody.innerHTML = "";
      a.topFiles.forEach(function (f) {
        var tr = document.createElement("tr");
        tr.innerHTML =
          '<td><code class="file-path">' +
          escapeHtml(f.path) +
          "</code></td>" +
          '<td class="num-col">' +
          formatNumber(f.changes) +
          "</td>";
        tbody.appendChild(tr);
      });
    }
  }

  // ═════════════════════════════════════════════════════════════════════
  //  EVENT LISTENERS
  // ═════════════════════════════════════════════════════════════════════

  function setupEvents() {
    document
      .getElementById("theme-toggle")
      .addEventListener("click", toggleTheme);

    if (window.matchMedia) {
      window
        .matchMedia("(prefers-color-scheme: dark)")
        .addEventListener("change", function (e) {
          if (!localStorage.getItem("insights-theme")) {
            applyTheme(e.matches ? "dark" : "light");
          }
        });
    }

    // Sync tab from URL hash on browser back/forward
    window.addEventListener("hashchange", function () {
      var tab = window.location.hash.replace("#", "");
      if (tab && TABS.indexOf(tab) !== -1) {
        switchTab(tab);
      }
    });

    document.querySelectorAll(".tab").forEach(function (btn) {
      btn.addEventListener("click", function () {
        switchTab(btn.getAttribute("data-tab"));
      });
    });

    document.querySelectorAll(".pill").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setTimeFilter(btn.getAttribute("data-filter"));
      });
    });

    var contributionSelect = document.getElementById("contribution-mode");
    if (contributionSelect) {
      contributionSelect.addEventListener("change", function () {
        state.contributionMode = contributionSelect.value;
        if (state.activeTab === "overview") {
          var d = getFilteredData();
          if (d && d.contributions) {
            renderContributionChart(
              d.contributions,
              d.frequency,
              state.contributionMode,
              d.contributors,
            );
            renderFrequencyMiniChart(d.frequency);
          }
        }
      });
    }

    var topContribSelect = document.getElementById("topcontributors-mode");
    if (topContribSelect) {
      topContribSelect.addEventListener("change", function () {
        state.topContributorsMode = topContribSelect.value;
        if (state.activeTab === "overview") {
          var d = getFilteredData();
          if (d && d.contributors) {
            renderTopContributorsChart(d.contributors, state.topContributorsMode);
          }
        }
      });
    }

    var dateStart = document.getElementById("date-start");
    var dateEnd = document.getElementById("date-end");
    if (dateStart) {
      dateStart.addEventListener("change", function () {
        state.customStartDate = dateStart.value || null;
        setTimeFilter("custom");
      });
    }
    if (dateEnd) {
      dateEnd.addEventListener("change", function () {
        state.customEndDate = dateEnd.value || null;
        setTimeFilter("custom");
      });
    }

    // Arrow-key navigation within tabs
    var tabsBar = document.querySelector(".tabs");
    if (tabsBar) {
      tabsBar.addEventListener("keydown", function (e) {
        var tabs = Array.prototype.slice.call(tabsBar.querySelectorAll(".tab"));
        var idx = tabs.indexOf(document.activeElement);
        if (idx === -1) return;

        if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
          e.preventDefault();
          var next =
            e.key === "ArrowRight"
              ? (idx + 1) % tabs.length
              : (idx - 1 + tabs.length) % tabs.length;
          var nextTab = tabs[next];
          var tabName = nextTab.getAttribute("data-tab");
          if (tabName) switchTab(tabName);
          nextTab.focus();
        }
      });
    }
  }

  // ═════════════════════════════════════════════════════════════════════
  //  INIT
  // ═════════════════════════════════════════════════════════════════════

  function init() {
    // Restore state from URL (if present)
    var hashTab = window.location.hash.replace("#", "");
    if (hashTab && TABS.indexOf(hashTab) !== -1) {
      state.activeTab = hashTab;
    }
    try {
      var params = new URL(window.location.href).searchParams;
      var filterParam = params.get("filter");
      if (filterParam && getCutoffDate(filterParam) !== undefined) {
        state.timeFilter = filterParam;
      }
      var startParam = params.get("start");
      var endParam = params.get("end");
      if (startParam) state.customStartDate = startParam;
      if (endParam) state.customEndDate = endParam;
    } catch (_) {
      /* ignore */
    }

    applyTheme(detectTheme());
    setupEvents();

    // Sync active pill state with loaded timeFilter
    document.querySelectorAll(".pill").forEach(function (btn) {
      btn.classList.toggle(
        "active",
        btn.getAttribute("data-filter") === state.timeFilter,
      );
    });

    var customRange = document.getElementById("custom-date-range");
    if (customRange) {
      customRange.classList.toggle("hidden", state.timeFilter !== "custom");
    }
    if (document.getElementById("date-start") && state.customStartDate) {
      document.getElementById("date-start").value = state.customStartDate;
    }
    if (document.getElementById("date-end") && state.customEndDate) {
      document.getElementById("date-end").value = state.customEndDate;
    }

    // Sync active tab state with loaded activeTab
    document.querySelectorAll(".tab").forEach(function (btn) {
      var match = btn.getAttribute("data-tab") === state.activeTab;
      btn.classList.toggle("active", match);
      btn.setAttribute("aria-selected", String(match));
    });
    document.querySelectorAll(".tab-content").forEach(function (sec) {
      sec.classList.toggle("active", sec.id === "tab-" + state.activeTab);
    });

    TABS.forEach(function (t) {
      showLoading(t);
    });

    loadData()
      .then(function () {
        TABS.forEach(function (t) {
          clearStates(t);
        });
        renderCurrentTab();
      })
      .catch(function () {
        // Errors already surfaced per-tab by loadData
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

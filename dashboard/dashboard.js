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

  function clampDate(dateStr, minStr, maxStr) {
    if (!dateStr) return dateStr;
    if (minStr && dateStr < minStr) return minStr;
    if (maxStr && dateStr > maxStr) return maxStr;
    return dateStr;
  }

  function getTodayLocal() {
    var d = new Date();
    var year = d.getFullYear();
    var month = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return year + "-" + month + "-" + day;
  }

  var _escapeDiv = null;

  function escapeHtml(str) {
    if (!_escapeDiv) _escapeDiv = document.createElement("div");
    _escapeDiv.textContent = str;
    return _escapeDiv.innerHTML;
  }

  function getDateRangeLabel(d) {
    var startLabel, endLabel;
    if (state.timeFilter === "allTime" && d && d.summary) {
      startLabel = formatDate(d.summary.firstCommit);
      endLabel = formatDate(d.summary.lastCommit);
    } else {
      var bounds = getCutoffDate(state.timeFilter);
      if (!bounds) {
        startLabel =
          d && d.summary ? formatDate(d.summary.firstCommit) : "Beginning";
        endLabel =
          d && d.summary ? formatDate(d.summary.lastCommit) : "Present";
      } else {
        startLabel = bounds.start ? formatDate(bounds.start) : "Beginning";
        endLabel = bounds.end
          ? formatDate(bounds.end)
          : formatDate(getTodayLocal());
      }
    }
    if (startLabel === endLabel) return startLabel;
    return startLabel + " \u2014 " + endLabel;
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

  function computeFilteredActivity(contributions) {
    var dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    var dayCounts = [0, 0, 0, 0, 0, 0, 0];
    var hourCounts = new Array(24).fill(0);
    var fileMap = {};

    for (var i = 0; i < contributions.length; i++) {
      var c = contributions[i];
      var jsDay = new Date(c.date + "T00:00:00Z").getUTCDay();
      var idx = (jsDay + 6) % 7;
      dayCounts[idx] += c.count;

      if (c.byHour) {
        for (var h = 0; h < c.byHour.length; h++) {
          hourCounts[h] += c.byHour[h].count;
        }
      }

      if (c.topFiles) {
        for (var j = 0; j < c.topFiles.length; j++) {
          var f = c.topFiles[j];
          fileMap[f.path] = (fileMap[f.path] || 0) + f.changes;
        }
      }
    }

    var byDayOfWeek = dayNames.map(function (day, i) {
      return { day: day, count: dayCounts[i] };
    });

    var byHour = Array.from(hourCounts, function (count, hour) {
      return { hour: hour, count: count };
    });

    var topFiles = Object.keys(fileMap)
      .map(function (path) {
        return { path: path, changes: fileMap[path] };
      })
      .sort(function (a, b) {
        return b.changes - a.changes || a.path.localeCompare(b.path);
      })
      .slice(0, 20);

    return {
      byDayOfWeek: byDayOfWeek,
      byHour: byHour,
      topFiles: topFiles,
    };
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

  function updateAllChartColors() {
    var theme = window.getScaleDefaults();
    var text = window.getTextColor();
    Object.keys(state.charts).forEach(function (id) {
      var chart = state.charts[id];
      if (!chart) return;

      var scales = chart.scales || {};
      if (scales.x) {
        scales.x.options.ticks.color = theme.x.ticks.color;
      }
      if (scales.y) {
        scales.y.options.ticks.color = theme.y.ticks.color;
        scales.y.options.grid.color = theme.y.grid.color;
      }

      var legend = chart.legend;
      if (legend && legend.options && legend.options.labels) {
        legend.options.labels.color = text;
      }

      chart.update();
    });
  }

  // ═════════════════════════════════════════════════════════════════════
  //  DATA LOADING & STATE MESSAGES
  // ═════════════════════════════════════════════════════════════════════

  var TABS = ["overview", "contributors", "activity"];

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
    if (state.timeFilter === filter && filter !== "custom") return;
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
      activity: computeFilteredActivity(filteredContributions),
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
      destroyChart("chart-contribution");
      destroyChart("chart-top-contributors");
      destroyChart("chart-frequency-overview");
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
    renderFrequencyOverviewChart(d.frequency);
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
    var TOP = 10;
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
    var isPrinting = document.body.classList.contains("printing");
    var top = contributors.slice(0, 10);

    var label, data;
    if (mode === "additions") {
      label = "Additions";
      data = top.map(function (c) {
        return c.additions;
      });
    } else if (mode === "deletions") {
      label = "Deletions";
      data = top.map(function (c) {
        return c.deletions;
      });
    } else {
      label = "Commits";
      data = top.map(function (c) {
        return c.totalCommits;
      });
    }

    createChart(
      "chart-top-contributors",
      "bar",
      {
        labels: top.map(function (c) {
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

  // -- Code frequency overview chart -----------------------------------

  function renderFrequencyOverviewChart(frequency) {
    if (!frequency || !frequency.length) {
      destroyChart("chart-frequency-overview");
      return;
    }

    createChart(
      "chart-frequency-overview",
      "line",
      {
        labels: frequency.map(function (x) {
          return x.date;
        }),
        datasets: [
          {
            label: "Additions",
            data: frequency.map(function (x) {
              return x.additions;
            }),
            borderColor: window.COLORS.green,
            backgroundColor: window.COLORS.green + "30",
            fill: true,
            tension: 0.3,
            pointRadius: frequency.length < 60 ? 2 : 0,
            pointHoverRadius: 4,
            borderWidth: 2,
          },
          {
            label: "Deletions",
            data: frequency.map(function (x) {
              return x.deletions;
            }),
            borderColor: window.COLORS.red,
            backgroundColor: window.COLORS.red + "30",
            fill: true,
            tension: 0.3,
            pointRadius: frequency.length < 60 ? 2 : 0,
            pointHoverRadius: 4,
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

  // ═════════════════════════════════════════════════════════════════════
  //  CONTRIBUTORS TAB
  // ═════════════════════════════════════════════════════════════════════

  function renderContributors(d) {
    clearStates("contributors");
    if (!d.contributors || !d.contributors.length) {
      destroyChart("chart-contributor-distribution");
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

    // -- Distribution bar chart (top N that fit, reversed so top is first) --
    var barHeight = 14;
    var maxChartHeight = 560;
    var maxBars = Math.floor(maxChartHeight / barHeight);
    var list = d.contributors.slice(0, maxBars).reverse();
    var chartHeight = Math.max(320, list.length * barHeight);

    var wrap = document.getElementById(
      "chart-contributor-distribution",
    ).parentElement;
    wrap.style.height = chartHeight + "px";

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
            barThickness: 12,
          },
        ],
      },
      {
        indexAxis: "y",
        scales: {
          y: {
            ticks: { font: { size: 11 }, autoSkip: false },
            grid: { display: false },
          },
          x: { beginAtZero: true },
        },
        plugins: { legend: { display: false } },
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
      destroyChart("chart-dayofweek");
      destroyChart("chart-hour");
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
    destroyChart("chart-hour");
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
    var tbody = document.querySelector("#topfiles-table tbody");
    if (tbody) tbody.innerHTML = "";
    if (a.topFiles && a.topFiles.length) {
      var fileCount = document.body.classList.contains("printing") ? 20 : 10;
      a.topFiles.slice(0, fileCount).forEach(function (f) {
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

    var exportBtn = document.getElementById("export-pdf");
    if (exportBtn) {
      exportBtn.addEventListener("click", function () {
        var filtered = getFilteredData();
        if (
          !filtered ||
          !filtered.contributions ||
          !filtered.contributions.length
        )
          return;

        var titleEl = document.querySelector(".header-title");
        var originalTitle = titleEl ? titleEl.textContent : "Insights";

        var dateLabel = getDateRangeLabel(filtered);
        var repoName =
          (state.data.summary && state.data.summary.repoName) || "";
        var printTitle = repoName
          ? repoName + " Insights: " + dateLabel
          : "Insights: " + dateLabel;
        if (titleEl) titleEl.textContent = printTitle;
        var originalDocTitle = document.title;
        document.title = printTitle;

        // Force dark text for print so canvas text is visible on white paper
        document.documentElement.style.setProperty("--text", "#000000");

        // Show all tab panels so canvases have dimensions when charts render
        document.body.classList.add("printing");
        // Force synchronous reflow so canvases get measured correctly
        void document.body.offsetHeight;

        // Render all tabs so every canvas has a chart before printing
        renderOverview(filtered);
        renderContributors(filtered);
        renderActivity(filtered);

        // Ensure Chart.js instances recalculate sizes to match print CSS
        Object.keys(state.charts).forEach(function (id) {
          try {
            state.charts[id].resize();
          } catch (e) {
            /* ignore individual chart resize failures */
          }
        });

        // After print (or cancel), restore original state
        var originalTab = state.activeTab;
        var cleanup = function () {
          window.removeEventListener("afterprint", cleanup);
          document.body.classList.remove("printing");
          document.documentElement.style.removeProperty("--text");
          if (titleEl) titleEl.textContent = originalTitle;
          document.title = originalDocTitle;
          renderCurrentTab();
        };
        window.addEventListener("afterprint", cleanup);

        setTimeout(function () {
          window.print();
        }, 100);
      });
    }

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
            renderTopContributorsChart(
              d.contributors,
              state.topContributorsMode,
            );
          }
        }
      });
    }

    var dateStart = document.getElementById("date-start");
    var dateEnd = document.getElementById("date-end");
    if (dateStart) {
      dateStart.addEventListener("change", function () {
        var today = getTodayLocal();
        var min =
          state.data && state.data.summary
            ? state.data.summary.firstCommit
            : null;
        var date = clampDate(dateStart.value || null, min, today);
        state.customStartDate = date;
        dateStart.value = date || "";
        if (date && state.customEndDate && state.customEndDate < date) {
          state.customEndDate = clampDate(date, null, today);
          if (dateEnd) dateEnd.value = state.customEndDate;
        }
        setTimeFilter("custom");
      });
    }
    if (dateEnd) {
      dateEnd.addEventListener("change", function () {
        var today = getTodayLocal();
        var min = state.customStartDate || null;
        var date = clampDate(dateEnd.value || null, min, today);
        state.customEndDate = date;
        dateEnd.value = date || "";
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
        // Clamp custom dates restored from URL params
        var startEl = document.getElementById("date-start");
        var endEl = document.getElementById("date-end");
        var today = getTodayLocal();
        if (startEl && state.customStartDate) {
          var clampedStart = clampDate(
            state.customStartDate,
            state.data.summary.firstCommit,
            today,
          );
          state.customStartDate = clampedStart;
          startEl.value = clampedStart;
        }
        if (endEl && state.customEndDate) {
          var endClampStart =
            state.customStartDate || state.data.summary.firstCommit || null;
          var clampedEnd = clampDate(state.customEndDate, endClampStart, today);
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

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

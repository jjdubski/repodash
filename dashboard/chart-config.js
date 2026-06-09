// fallow-ignore-file unused-file
/* ═════════════════════════════════════════════════════════════════════
   Insights Dashboard — Chart.js Configuration
   ═════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // Guard: bail if Chart.js CDN failed to load
  if (typeof Chart === 'undefined') {
    console.error('Chart.js not loaded — dashboard charts will not render.');
    return;
  }

  // -------------------------------------------------------------------
  // Register Chart.js components
  // -------------------------------------------------------------------
  Chart.register(
    Chart.BarController,
    Chart.LineController,
    Chart.LineElement,
    Chart.BarElement,
    Chart.PointElement,
    Chart.CategoryScale,
    Chart.LinearScale,
    Chart.Filler,
  );

  // -------------------------------------------------------------------
  // Color palette — matches design spec
  // -------------------------------------------------------------------
  window.COLORS = {
    blue: '#58a6ff',
    green: '#3fb950',
    amber: '#d29922',
    red: '#f85149',
    purple: '#a371f7',
    orange: '#db6d28',
    cyan: '#39d2c0',
    pink: '#f778ba',
  };

  // Convenience: ordered array for cycling through dataset colors
  window.COLOR_LIST = [
    '#58a6ff',
    '#3fb950',
    '#d29922',
    '#f85149',
    '#a371f7',
    '#db6d28',
    '#39d2c0',
    '#f778ba',
  ];

  // -------------------------------------------------------------------
  // Shared option defaults (these go inside `options: { ... }` of a
  // Chart.js config object).  Chart renderers should merge these with
  // any customizations via Object.assign / manual deep merge.
  // -------------------------------------------------------------------
  window.CHART_DEFAULTS = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 400 },
    plugins: {
      legend: { display: true, position: 'bottom' },
      tooltip: { mode: 'index', intersect: false },
    },
    scales: {
      x: { grid: { display: false } },
      y: { beginAtZero: true, grid: { color: 'rgba(128,128,128,0.1)' } },
    },
  };

  // -------------------------------------------------------------------
  // Read theme-aware scale defaults from CSS custom properties.
  // Returns { x: { ticks, grid }, y: { ticks, grid } } with current
  // theme colors.  Call at chart-creation time so colors are fresh.
  // -------------------------------------------------------------------
  window.getScaleDefaults = function () {
    const style = getComputedStyle(document.documentElement);
    const textSecondary = style.getPropertyValue('--text-secondary').trim() || '#656d76';
    const chartGrid = style.getPropertyValue('--chart-grid').trim() || 'rgba(128,128,128,0.1)';
    return {
      x: {
        ticks: { color: textSecondary },
        grid: { display: false },
      },
      y: {
        beginAtZero: true,
        ticks: { color: textSecondary },
        grid: { color: chartGrid },
      },
    };
  };

  // -------------------------------------------------------------------
  // Read current theme's text color (used for legend labels, etc.)
  // -------------------------------------------------------------------
  window.getTextColor = function () {
    return getComputedStyle(document.documentElement).getPropertyValue('--text').trim();
  };
})();

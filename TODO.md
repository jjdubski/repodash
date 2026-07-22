# TODO

1. **Language Breakdown** — File-extension distribution analysis (% JS, Python, etc.). Pie chart or bar on Overview tab.
2. **`--csv` flag** — Same semantics as `--pdf` — writes a CSV report of contributors and frequency data to the given path.
3. **Comparison tab** — New tab after Activity. Side-by-side charts comparing two time periods. Same pill filters (All Time, Past Year, etc.) for each side independently. Show ▲/▼ percent change in green/red on metric cards.
4. **Frontend test suite** — Expand `dashboard.test.js` to cover rendering helpers, chart data transformations, edge cases (empty data, single contributor, large datasets). Add snapshot tests for HTML output.
5. **Inline critical CSS** — Extract above-the-fold CSS from `style.css` and inline it in `<head>` in `index.html`. Load full stylesheet asynchronously.
6. **`--user` flag** — Show all commits for a given author across all repos on GitHub. Uses public GitHub API; combine with `--token` for private repos.
7. **Dashboard repo filtering** — Allow filtering the dashboard by repository (default: all history).
8. **`--token` for private repos** — Show all public commits; `--token` for private repo access.
9. **`-h` output audit** — Ensure all available flags are listed in `-h` with appropriate descriptions.
10. **PDF layout — combined day/hour charts** — Make "Commits by Day of Week" and "Commits by Hour of Day" share one PDF page (stacked vertically).
11. **Dynamic concurrency** — Tune parallel worker count based on system CPU/memory info instead of hard max of 8.
12. **Playwright E2E tests** — Expand Playwright coverage beyond the single basic smoke test.

# TODO

1. **Language Breakdown** — File-extension distribution analysis (% JS, Python, etc.). Pie chart or bar on Overview tab.
2. **`--csv` flag** — Same semantics as `--pdf` — writes a CSV report of contributors and frequency data to the given path.
3. **Frontend test suite** — Expand `dashboard.test.js` to cover rendering helpers, chart data transformations, edge cases (empty data, single contributor, large datasets). Add snapshot tests for HTML output.
4. **`--user` flag** — Show all commits for a given author across all repos on GitHub. Uses public GitHub API; combine with `--token` for private repos.
5. **Dashboard repo filtering** — Allow filtering the dashboard by repository (default: all history).
6. **`--token` for private repos** — Show all public commits; `--token` for private repo access.
7. **`-h` output audit** — Ensure all available flags are listed in `-h` with appropriate descriptions.
8. **PDF layout — combined day/hour charts** — Make "Commits by Day of Week" and "Commits by Hour of Day" share one PDF page (stacked vertically).
9. **Dynamic concurrency** — Tune parallel worker count based on system CPU/memory info instead of hard max of 8.
10. **Playwright E2E tests** — Expand Playwright coverage beyond the single basic smoke test.

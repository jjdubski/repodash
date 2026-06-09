# insights

Generate a GitHub-style interactive insights dashboard for **any** local git repository — no server, no sign-up, no uploads. Runs entirely on your machine.

![screenshot](https://github.com/user-attachments/assets/placeholder)

> **Status:** Pre-release (v0.1.0)

---

## Quick start

```bash
npx insights /path/to/your/repo
# or install globally:
npm install -g insights
insights /path/to/your/repo
```

A browser tab opens showing five dashboard panels: summary stats, contribution timeline, contributor breakdown, commit frequency, and activity heatmap.

---

## Prerequisites

- **Node.js >= 18** (ESM runtime)
- **git** on `PATH` (the tool shells out to `git log --all --numstat`)

No build tools, compilers, or bundlers required.

---

## Usage

```bash
insights /path/to/git/repo
```

The CLI:

1. Scans the repo's full commit history via `git log --all --numstat`
2. Aggregates the data into 5 datasets (summary, contributions, contributors, frequency, activity)
3. Starts a local HTTP server and opens your default browser
4. Cleans up temp files when the server stops (Ctrl+C)

### Dashboard features

- **Summary tab** — total commits, contributors, files changed, lines added/deleted, first & last commit dates
- **Contributions tab** — commits over time (daily bar chart)
- **Contributors tab** — top contributors by commit count (horizontal bar chart)
- **Frequency tab** — commit distribution by weekday/hour (heatmap grid)
- **Activity tab** — cumulative commit timeline (area chart)
- **Time filters** — All / 30 days / 7 days
- **Dark/Light theme** — toggle in the top-right corner

---

## Development

```bash
git clone https://github.com/lsi-digital/insights.git
cd insights
npm install
```

### Commands

| Command                              | What it does                                         |
| ------------------------------------ | ---------------------------------------------------- |
| `npm start`                          | Run insights (shows usage without a path argument)   |
| `node bin/insights.js /path/to/repo` | Generate dashboard for a specific repo               |
| `npm test`                           | Runs 3 of 6 test suites (imports, aggregate, server) |
| `node --test tests/*.test.js`        | Runs **all** 6 test suites                           |

### Testing quirks

- Uses Node.js built-in `node:test` + `node:assert` (no Jest/Vitest).
- `npm test` only runs a subset (`imports`, `aggregate`, `server`). Run the other 3 manually:

```bash
node --test tests/git.test.js
node --test tests/dashboard.test.js
node --test tests/index.test.js
```

- `git.test.js` creates real temporary git repos (git must be on `PATH`).
- `aggregate.test.js` includes a performance assertion — must process 5000 commits in under 500ms.
- No lint, typecheck, CI, or pre-commit hooks are configured.

---

## How it works

```text
repo path ──→ git log --all --numstat ──→ aggregate() ──→ 5 JSON datasets ──→ dashboard
                     (streaming parser)       (pure function)    (temp files)    (Chart.js 4)
```

- **Git parser** streams the output of `git log --all --numstat` through a custom delimiter (`---COMMIT---`) to handle large repositories without loading everything into memory.
- **Aggregate** is a pure function with no I/O — takes raw commits in, returns structured datasets out. Trivially testable.
- **Server** writes JSON data files to `/tmp/insights-XXXXX/data/`, serves them alongside the static `dashboard/` files, and opens the browser.
- **Dashboard** is vanilla HTML/CSS/JS with Chart.js 4 loaded from CDN. No framework, no build step.
- **Timezones** — all time-based aggregation (hour of day, day of week) uses **UTC** via `jsDate.getUTCHours()` / `jsDate.getUTCDay()` in `src/aggregate.js`.

---

## Project structure

```text
bin/insights.js          CLI entrypoint (shebang)
src/index.js             Orchestrator
src/git.js               Git command runner + streaming parser
src/aggregate.js         Pure function: commits → datasets
src/server.js            HTTP server + browser opener
dashboard/index.html     SPA shell
dashboard/dashboard.js   Chart rendering + tab/filter logic
dashboard/style.css      Light + dark themes via CSS custom properties
dashboard/chart-config.js  Chart.js registration & defaults
tests/                   Test files (imports, aggregate, server,
                          git, dashboard, index)
```

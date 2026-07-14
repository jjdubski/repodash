# insights

Generate a GitHub-style interactive insights dashboard for **any** local git repository — no server, no sign-up, no uploads. Runs entirely on your machine.

![screenshot](https://github.com/user-attachments/assets/placeholder)

> **Status:** Pre-release v0.3.0

---

## Quick start

```bash
npx insights /path/to/your/repo
# or install globally:
npm install -g insights
insights /path/to/your/repo
```

A browser tab opens showing the dashboard with three tabbed panels: Overview, Contributors, and Activity.

You can also point the tool at a **remote repository URL**:

```bash
insights https://github.com/owner/repo.git
# with a token for private repos:
insights https://github.com/owner/private-repo.git --token ghp_xxx
```

---

## Prerequisites

- **Node.js >= 18** (ESM runtime)
- **git** on `PATH` (the tool shells out to `git log --all --numstat`)

No build tools, compilers, or bundlers required.

---

## Usage

```bash
insights [options] <path-to-git-repo>
```

### Options

| Flag                | Description                                                                                              |
| ------------------- | -------------------------------------------------------------------------------------------------------- |
| `-h`, `--help`      | Show help message                                                                                        |
| `-V`, `--version`   | Show version number                                                                                      |
| `--json`            | Print datasets as JSON to stdout (no server)                                                             |
| `--file [path]`     | Write datasets as JSON to a file (default: repo directory)                                               |
| `--timing`          | Show timing breakdown for each step                                                                      |
| `--no-merges`       | Exclude merge commits (faster for large repos)                                                           |
| `--concurrency <n>` | Number of parallel workers (default: CPU count, max: 8)                                                  |
| `--token <token>`   | GitHub personal access token for private remote repos                                                    |
| `--summary`         | Include summary dataset (when used with --json/--file)                                                   |
| `--contributions`   | Include contributions dataset                                                                            |
| `--contributors`    | Include contributors dataset                                                                             |
| `--frequency`       | Include frequency dataset                                                                                |
| `--activity`        | Include activity dataset                                                                                 |
| `--pdf <path>`      | Generate a PDF report at the specified path. Requires Playwright — run `npx playwright install chromium` |

If none of `--summary`/`--contributions`/`--contributors`/`--frequency`/`--activity` are specified, all datasets are included. `--json` and `--file` are mutually exclusive.

### What happens

1. Scans the repo's full commit history via `git log --all --numstat`
2. Processes commits in **parallel** (slicing history into quarters, farming each slice to a concurrency pool)
3. Aggregates the data into 5 datasets (summary, contributions, contributors, frequency, activity)
4. Starts a local HTTP server and opens your default browser (or outputs JSON / PDF)
5. Cleans up temp files on exit (or `Ctrl+C`)

### Dashboard features

- **Overview tab** — metric cards (total commits, contributors, lines added/deleted), contribution graph (by author or by commits), top contributors bar chart, additions & deletions over time line chart
- **Contributors tab** — sortable table with pagination (name, commits, additions, deletions, first/last commit), commit distribution bar chart
- **Activity tab** — commits by day of week, commits by hour of day, top changed files table
- **Time filters** — All Time / Past Year / Last 3 Months / This Week / Custom date range
- **Dark/Light theme** — toggle in the top-right corner, persisted to localStorage
- **PDF export** — generates a formatted PDF report with all three tabs (client-side via html2canvas + jsPDF)
- **Keyboard navigation** — arrow keys between tabs and time-filter pills, skip-to-content link
- **Responsive design** — adapts to tablet and mobile viewports
- **Print styles** — optimized layout when using the browser's Print function
- **Web Worker** — filtering/downsampling offloaded to a background thread for smooth UI

---

## Development

```bash
git clone https://github.com/lsi-digital/insights.git
cd insights
npm install
```

### Commands

| Command                              | What it does                                       |
| ------------------------------------ | -------------------------------------------------- |
| `npm start`                          | Run insights (shows usage without a path argument) |
| `node bin/insights.js /path/to/repo` | Generate dashboard for a specific repo             |
| `npm test`                           | Runs **all** 13 test suites + 1 E2E suite          |
| `npm run test:e2e`                   | Runs only the Playwright E2E test suite            |
| `npm run lint`                       | ESLint                                             |
| `npm run lint:md`                    | markdownlint                                       |
| `npm run lint:css`                   | stylelint                                          |
| `npm run format`                     | Prettier auto-format                               |
| `npm run reviewdog`                  | Run all 5 linters locally via reviewdog            |

### Testing quirks

- Uses Node.js built-in `node:test` + `node:assert` (no Jest/Vitest).
- `npm test` runs all test files matching `tests/**/*.test.js` and `tests/**/*.e2e.js`.
- `git.test.js` creates real temporary git repos (git must be on `PATH`).
- `aggregate.test.js` includes a performance assertion — must process 5000 commits in under 500ms.
- E2E tests (`tests/e2e/dashboard.e2e.js`) require Playwright: `npx playwright install chromium`.
- Lint, CI, and pre-commit hooks are configured via Husky + lint-staged.

---

## How it works

```text
repo path ──→ git log --all --numstat ──→ aggregate() ──→ 5 JSON datasets ──→ dashboard
                     (streaming parser)       (pure function)    (temp files)       (Chart.js 4)
                                                    │
                                            parallel workers
                                          (year/quarter slices)
```

- **CLI** (`src/cli.js`) — argument parsing with `node:util.parseArgs`, handles all flags and validation.
- **Git parser** (`src/git.js`) — spawns `git log --all --numstat`, streams output through a custom delimiter (`---COMMIT---`) to handle large repositories without loading everything into memory. Supports RFC 2047 encoded author names. Can also clone remote repos.
- **Aggregate** (`src/aggregate.js`) — pure function with no I/O. Takes raw commits in, returns structured datasets out. Processes commits in parallel by splitting history into quarter-year slices, farming each slice to a concurrency pool, then merging results. Trivially testable.
- **Server** (`src/server.js`) — writes JSON data files to `{os.tmpdir()}/insights-XXXXX/data/`, serves them alongside the static `dashboard/` files. Path-traversal protected. CSP headers included.
- **Dashboard** — vanilla HTML/CSS/JS with Chart.js 4 loaded from CDN. No framework, no build step. Uses a Web Worker for background data filtering. Client-side PDF export via html2canvas + jsPDF.
- **Timezone note** — all time-based aggregation (hour of day, day of week) uses **UTC** via `jsDate.getUTCHours()` / `jsDate.getUTCDay()` in `src/aggregate.js`.

### Contributor deduplication

Contributors are keyed by **email**. A special pass merges entries detected as the same person via GitHub noreply emails (`user@users.noreply.github.com`). Per-day contributions track authors by email, so contributors with the same name but different emails remain separate.

---

## Project structure

```text
bin/insights.js             CLI entrypoint (shebang)
src/
  cli.js                    Argument parsing & validation
  index.js                  Orchestrator (main function)
  git.js                    Git command runner + streaming parser + remote clone
  aggregate.js              Pure function: commits → datasets (parallel processing)
  server.js                 HTTP server + browser opener
dashboard/
  index.html                SPA shell
  dashboard.js              Chart rendering + tab/filter logic + PDF export
  filter.js                 Pure filter/utility functions (shared with worker)
  worker.js                 Web Worker for background data filtering
  chart-config.js           Chart.js registration & defaults & color palette
  style.css                 Light + dark themes via CSS custom properties
  favicon.svg               Bar-chart favicon
  fonts/
    NotoSansMultilanguage-Regular.ttf   Unicode/CJK font for PDF export
tests/
  aggregate.test.js         Unit tests for aggregate()
  aggregate-stream.test.js  Tests for streaming + parallel aggregation
  cli.test.js               Tests for CLI argument parsing
  cleanup.test.js           Tests for temp dir cleanup on SIGINT
  dashboard.test.js         Tests for dashboard chart functions
  git.test.js               Integration tests for git parser
  git-new-features.test.js  Tests for year range, active years, author name cleaning
  git-remote.test.js        Tests for remote repo cloning
  imports.test.js           Module import smoke tests
  index.test.js             Integration tests for main orchestrator
  server.test.js            HTTP server tests
  e2e/
    dashboard.e2e.js        Playwright end-to-end tests
```

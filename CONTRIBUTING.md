# Contributing

## Development

```bash
git clone https://github.com/jjdubski/repodash.git
cd repodash
npm install
```

## Commands

| Command                              | What it does                                       |
| ------------------------------------ | -------------------------------------------------- |
| `npm start`                          | Run repodash (shows usage without a path argument) |
| `node bin/repodash.js /path/to/repo` | Generate dashboard for a specific repo             |
| `npm test`                           | Runs all 13 test suites + 1 E2E suite              |
| `npm run test:e2e`                   | Runs only the Playwright E2E test suite            |
| `npm run lint`                       | ESLint                                             |
| `npm run lint:md`                    | markdownlint                                       |
| `npm run lint:css`                   | stylelint                                          |
| `npm run format`                     | Prettier auto-format                               |
| `npm run reviewdog`                  | Run all 5 linters locally via reviewdog            |

## Testing quirks

- Uses Node.js built-in `node:test` + `node:assert` (no Jest/Vitest).
- `npm test` runs all test files matching `tests/**/*.test.js` and `tests/**/*.e2e.js`.
- `git.test.js` creates real temporary git repos (git must be on `PATH`).
- `aggregate.test.js` includes a performance assertion — must process 5000 commits in under 500ms.
- E2E tests (`tests/e2e/dashboard.e2e.js`) require Playwright: `npx playwright install chromium`.
- Lint, CI, and pre-commit hooks are configured via Husky + lint-staged.

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
- **Server** (`src/server.js`) — writes JSON data files to `{os.tmpdir()}/repodash-XXXXX/data/`, serves them alongside the static `dashboard/` files. Path-traversal protected. CSP headers included.
- **Dashboard** — vanilla HTML/CSS/JS with Chart.js 4 loaded from CDN. No framework, no build step. Uses a Web Worker for background data filtering. Client-side PDF export via html2canvas + jsPDF.
- **Timezone note** — all time-based aggregation (hour of day, day of week) uses the **author's local time** as recorded by git's `%ai` format. The `src/aggregate.js` extracts the hour directly from the ISO date string and derives day-of-week from the author's local date.

## Contributor deduplication

Contributors are keyed by **email**. A special pass merges entries detected as the same person via GitHub noreply emails (`user@users.noreply.github.com`). Per-day contributions track authors by email, so contributors with the same name but different emails remain separate.

## Project structure

```text
bin/repodash.js             CLI entrypoint (shebang)
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

# repodash

Pure Node.js ESM CLI tool that generates a GitHub-style insights dashboard for any local git repo. Vanilla HTML/CSS/JS frontend, no build step, no TypeScript, no bundler.

## Architecture

```text
bin/repodash.js             — CLI entrypoint (#!/usr/bin/env node)
src/
  cli.js                    — argument parsing & validation
  index.js                  — orchestrator (main function)
  git.js                    — git command runner + streaming parser + remote clone
  github.js                 — GitHub API client (fetchUserRepos)
  aggregate.js              — pure function: raw commits → 5 datasets (parallel)
  csv.js                    — CSV generation with formula-injection sanitization
  server.js                 — HTTP server, writes JSON to temp dir, opens browser
dashboard/
  index.html                — SPA shell
  dashboard.js              — Chart.js 4 rendering + tab/filter/PDF logic
  filter.js                 — pure filter/utility functions (shared with worker)
  worker.js                 — Web Worker for background filtering
  chart-config.js           — Chart.js registration & defaults & color palette
  style.css                 — light + dark theme via CSS custom properties
  favicon.svg               — bar-chart favicon
  fonts/
    NotoSansMultilanguage-Regular.ttf  — Unicode/CJK font for PDF export
```

- `aggregate.js` is the pure core — no I/O, trivially testable. The primary entry point is `aggregateStreamParallel()` which splits history into quarter-year slices and farms them to a concurrency pool.
- Git parser streams `git log --all --numstat` line-by-line, flushing on a `---COMMIT---` delimiter to handle large repos without loading everything into memory.
- CLI parsing in `src/cli.js` uses `node:util.parseArgs` — handles all flags (`--json`, `--file`, `--csv`, `--pdf`, `--timing`, `--no-merges`, `--concurrency`, `--token`, `--user`, dataset filters).
- Output modes: dashboard (HTTP server + browser open), JSON to stdout (`--json`), JSON to file (`--file`), CSV report (`--csv`), PDF report (`--pdf`, requires Playwright).
- Supports remote repository URLs (clones to temp dir, auto-cleans on exit). Can use `--token ghp_xxx` for private repos. Multi-repo analysis via `--user` (fetches repos via GitHub API).
- Data JSON files generated at runtime in `{os.tmpdir()}/repodash-XXXXX/data/`. Stale temp dirs from crashed runs cleaned up on next startup (older than 5 minutes).
- Path traversal protection in `server.js` with CSP headers. Browser auto-open suppressible via `REPODASH_DISABLE_OPEN` env var or `openBrowser: false` option.
- No native dependencies — zero npm install is needed for `npx repodash` usage.

## Dashboard

Three tabbed panels rendered client-side with Chart.js 4 (CDN-loaded):

| Tab              | Charts & content                                                                                                                                                                                                                                |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Overview**     | Metric cards (commits, contributors, additions, deletions), contribution graph (by author/commits with mode toggle), top contributors bar (by commits/additions/deletions), additions & deletions line chart, language breakdown doughnut chart |
| **Contributors** | Sortable + paginated table (name, commits, additions, deletions, first/last commit), commit distribution bar chart, pagination (50–1000 per page)                                                                                               |
| **Activity**     | Commits by day-of-week bar, commits by hour-of-day bar, top changed files table                                                                                                                                                                 |

Filtering/downsampling offloaded to a **Web Worker** (`worker.js`) for smooth UI. Data filtering recomputes summary stats per time range. Time filter pills: All Time / Past Year / Last 3 Months / This Week / Custom date range. Dark/light theme persisted to localStorage.

## Data flow

```
repo path
  │
  ▼
src/cli.js (parse flags)
  │
  ├── --user → src/github.js (fetchUserRepos → clone each via src/git.js)
  │
  ▼
src/git.js (spawn git log --all --numstat, stream commits)
  │
  ▼
src/aggregate.js::aggregateStreamParallel()
  ├─ getCommitYearRange() → createYearSlices() → quarter slices
  ├─ concurrencyPool(): each slice calls getAllCommits() + processCommitsStream()
  ├─ mergeAllStates() → finalizeResults() → mergeNoreplyContributors() → formatResults()
  │
  ▼
Output (chosen by flags):
  ├─ src/server.js → HTTP + browser open (dashboard mode)
  ├─ --json → stdout JSON
  ├─ --file [path] → file dump
  ├─ --csv [path] → src/csv.js → file dump
  └─ --pdf [path] → Headless Playwright → PDF export
```

## Key exported APIs

| Module                | Key exports                                                                                                                                         | Purpose                                                        |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `src/cli.js`          | `parseAndValidate(argv)`                                                                                                                            | Returns `{ repoPath, values }` with parsed flags               |
| `src/index.js`        | `main(repoPath, options)`, `setupShutdownHandlers(fn)`                                                                                              | Orchestrator, signal/cleanup registration                      |
| `src/git.js`          | `getAllCommits()`, `cloneRemoteRepo()`, `getRemoteUrl()`, `getLocalBranchCount()`, `getCommitYearRange()`, `findActiveYears()`, `cleanAuthorName()` | Git interaction                                                |
| `src/github.js`       | `fetchUserRepos(username, token)`                                                                                                                   | GitHub API — paginated repo list for a user                    |
| `src/aggregate.js`    | `aggregate()`, `aggregateStream()`, `aggregateStreamParallel()`, `createYearSlices()`, `concurrencyPool()`                                          | Data processing                                                |
| `src/csv.js`          | `generateCsvReport(data, outPath)`, `csvField(value)`                                                                                               | CSV export with CWE-1236 protection                            |
| `src/server.js`       | `serveDashboard(data, dashboardDir, port)`                                                                                                          | HTTP server                                                    |
| `dashboard/filter.js` | `formatNumber`, `formatDate`, `filterByDate`, `downsampleData`, `computeFiltered*`, `sortContributors`                                              | Shared pure functions (imported by dashboard.js and worker.js) |

## Commands

| Command                               | Notes                                                                                          |
| ------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `npm start`                           | Runs `node bin/repodash.js` (no args → shows usage)                                            |
| `npm test`                            | Runs all tests matching `tests/**/*.test.js` and `tests/e2e/*.e2e.js` (16 test suites + 1 E2E) |
| `npm run test:e2e`                    | Runs only the Playwright E2E test suite (`tests/e2e/dashboard.e2e.js`)                         |
| `node --test tests/aggregate.test.js` | Single test file                                                                               |
| `npm run format`                      | Prettier auto-format                                                                           |
| `npm run format:check`                | Prettier check only                                                                            |
| `node bin/repodash.js /path/to/repo`  | Generate dashboard for a specific repo                                                         |
| `node bin/repodash.js --help`         | Show all available flags                                                                       |

## Linting & reviewdog

`reviewdog` can be run locally with `npm run reviewdog` (requires reviewdog to be installed on PATH).

| Command             | What it runs                              | Requires                            |
| ------------------- | ----------------------------------------- | ----------------------------------- |
| `npm run lint`      | ESLint                                    | _none (npx)_                        |
| `npm run lint:md`   | markdownlint                              | _none (npx)_                        |
| `npm run lint:css`  | stylelint                                 | _none (npx)_                        |
| `npm run reviewdog` | All 5 linters via `.reviewdog.yml` config | reviewdog + actionlint + shellcheck |

The `.reviewdog.yml` file defines 5 runners (eslint, actionlint, markdownlint, shellcheck, stylelint)
matching the same workflow that runs in CI.

**To run reviewdog locally:**

1. Install the CLI: `brew install reviewdog`
2. Install additional binaries: `brew install actionlint shellcheck`
3. Run: `npm run reviewdog` (or `reviewdog` with no args)

reviewdog defaults to `-reporter=local`, which prints lint results to stdout. To report only
on changed lines (useful during development), run:

```sh
reviewdog -diff="git diff" -reporter=local
```

reviewdog exits with code 1 if any runner fails (e.g., missing binaries). The individual
runners that are available (ESLint, stylelint, markdownlint) still produce correct output.
To run a single runner:

```sh
reviewdog -reporter=local -conf=.reviewdog.yml  # all runners
# Filter to specific runners by commenting out others in .reviewdog.yml
```

## Testing quirks

- Framework: built-in `node:test` + `node:assert` (no Jest, no Vitest).
- `npm test` runs all test files matching `tests/**/*.test.js` and `tests/e2e/*.e2e.js` (16 test suites + 1 E2E).
- `npm run test:e2e` runs only the Playwright E2E test suite.
- `git.test.js` creates real temp git repos (needs actual git on PATH).
- `aggregate.test.js` has performance assertions (<500ms for 5000 commits).
- CI via GitHub Actions (test.yml, fallow.yml, reviewdog.yml, trigger.yml).
- Pre-commit hooks via Husky + lint-staged (prettier + eslint --fix on staged JS).
- No typecheck — Vanilla JS only.

## Dependencies

- Runtime: `chalk` ^5.4.1, `open` ^10.2.0
- Requires **Node.js >= 18**
- Chart.js 4 loaded from CDN in `dashboard/index.html`

## Style

- ESM throughout (`"type": "module"`)
- No comments in code
- Pure functions preferred where possible
- Prefer using an optional chain expression instead, as it's more concise and easier to read.
- Prefer globalThis.window instead of window
- Use `.includes()`, rather than `.indexOf()`, when checking for existence.
- Prefer let or const, do not use var unless absolutely necessary

## Contributor deduplication

Contributors are keyed by **email** in `src/aggregate.js`'s `contributorsMap`. A special pass merges entries detected as the same person via GitHub noreply emails (`user@users.noreply.github.com`):

- The local part of a noreply address is the GitHub username (stripping any numeric `ID+` prefix).
- For each non-noreply contributor, two checks run (case-insensitive):
  1. Does any of their commit author names match a known GitHub username?
  2. Does their email's local part (before `@`) exactly match a known GitHub username?
- If either matches, the non-noreply contributor's stats are **merged into** the noreply entry — totals are summed, earliest/latest dates kept. Per-day `contributionsMap` author entries are also rewritten so the source's days are folded into the target's author name.

Per-day contributions (`contributionsMap`) track authors by **email**, not by display name. This means two contributors with the same display name but different emails (e.g. `user@work.com` and `user@personal.com`, both named "User") remain separate entries with their own per-day stats. The `authorDetails` array in each day's contribution includes an `email` field, which the frontend uses to match each contributor to their correct stats.

## Timezone note

The "commit by hour of day" chart uses the **author's local time** as recorded by git's `%ai` format (which includes the author's timezone offset). The `src/aggregate.js` function `processSingleCommit` extracts the hour directly from the ISO date string at positions 11-12, and derives day-of-week from the author's local date. No conversion to the viewer's timezone is performed; the chart shows the hour each author committed at in their own timezone.

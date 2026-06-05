# Insights

Pure Node.js ESM CLI tool that generates a GitHub-style insights dashboard for any local git repo. Vanilla HTML/CSS/JS frontend, no build step, no TypeScript, no bundler.

## Architecture

```text
bin/insights.js          — CLI entrypoint (#!/usr/bin/env node)
src/index.js             — orchestrator
src/git.js               — spawns git log --all --numstat (streaming parser)
src/aggregate.js         — pure function: raw commits -> 5 datasets
src/server.js            — HTTP server, writes JSON to temp dir, opens browser
dashboard/index.html     — SPA shell
dashboard/dashboard.js   — Chart.js 4 (CDN) rendering + tab/filter logic
dashboard/style.css      — light + dark theme via custom properties
```

- `aggregate()` is the pure core — no I/O, trivially testable.
- Git parser streams with `split('---COMMIT---')` to handle large repos.
- Data JSON files generated at runtime in `/tmp/insights-XXXXX/data/`.
- Path traversal protection in `server.js`.

## Commands

| Command                               | Notes                                                        |
| ------------------------------------- | ------------------------------------------------------------ |
| `npm start`                           | Runs `node bin/insights.js` (no args → shows usage)          |
| `npm test`                            | **Only runs 3 of 6 test files** (imports, aggregate, server) |
| `node --test tests/*.test.js`         | Runs **all 6** test files                                    |
| `node --test tests/aggregate.test.js` | Single test file                                             |
| `node bin/insights.js /path/to/repo`  | Generate dashboard                                           |

## Testing quirks

- Framework: built-in `node:test` + `node:assert` (no Jest, no Vitest).
- `npm test` skips `git.test.js`, `dashboard.test.js`, `index.test.js` — must run manually with `node --test`.
- `git.test.js` creates real temp git repos (needs actual git on PATH).
- `aggregate.test.js` has performance assertions (<500ms for 5000 commits).
- No CI, no pre-commit hooks, no lint, no typecheck — zero devDependencies.

## Dependencies

- Runtime: `chalk` ^5.4.1, `open` ^10.2.0
- Requires **Node.js >= 18**
- Chart.js 4 loaded from CDN in `dashboard/index.html`

## Style

- ESM throughout (`"type": "module"`)
- No comments in code
- Pure functions preferred where possible

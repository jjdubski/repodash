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

## Contributor deduplication

Contributors are keyed by **email** in `src/aggregate.js`'s `contributorsMap`. A special pass merges entries detected as the same person via GitHub noreply emails (`user@users.noreply.github.com`):

- The local part of a noreply address is the GitHub username (stripping any numeric `ID+` prefix).
- For each non-noreply contributor, two checks run (case-insensitive):
  1. Does any of their commit author names match a known GitHub username?
  2. Does their email's local part (before `@`) exactly match a known GitHub username?
- If either matches, the non-noreply contributor's stats are **merged into** the noreply entry — totals are summed, earliest/latest dates kept. Per-day `contributionsMap` author entries are also rewritten so the source's days are folded into the target's author name.

Per-day contributions (`contributionsMap`) track authors by **email**, not by display name. This means two contributors with the same display name but different emails (e.g. `user@work.com` and `user@personal.com`, both named "User") remain separate entries with their own per-day stats. The `authorDetails` array in each day's contribution includes an `email` field, which the frontend uses to match each contributor to their correct stats.

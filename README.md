# repodash

Generate a GitHub-style interactive insights dashboard for **any** git repository (local or remote) — no server, no sign-up, no uploads. Runs entirely on your machine.

<!-- ![screenshot](https://github.com/user-attachments/assets/placeholder) -->

---

## Quick start

```bash
npx repodash /path/to/your/repo
# or install globally:
npm install -g repodash
repodash /path/to/your/repo
```

A browser tab opens showing the dashboard with three tabbed panels: Overview, Contributors, and Activity.

You can also point the tool at a **remote repository URL**:

```bash
repodash https://github.com/owner/repo.git
# with a token for private repos:
repodash https://github.com/owner/private-repo.git --token ghp_xxx
```

---

## Prerequisites

- **Node.js >= 18** (ESM runtime)
- **git** on `PATH` (the tool shells out to `git log --all --numstat`)

No build tools, compilers, or bundlers required.

---

## Usage

```bash
repodash [options] <path-to-git-repo>
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

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, commands, testing quirks, architecture overview, and project structure.

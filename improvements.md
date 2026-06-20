# Proposed Improvements for `insights`

This document outlines potential improvements for the `insights` project, categorized by priority.

## High Priority

### 1. Error Visibility in Aggregation

**Location:** `src/aggregate.js`
**Issue:** In `aggregateStreamParallel`, if `getCommitYearRange` fails (e.g., due to a git error), it catches the error and returns `{ firstYear: null, lastYear: null }`. This causes the dashboard to show an empty state without informing the user why the scan failed.
**Recommendation:** Log a warning to `stderr` with the repository path or re-throw the error to allow the CLI to handle it more gracefully.

### 2. Git Streaming Error Feedback

**Location:** `src/git.js`
**Issue:** If `git log` fails mid-stream (e.g., due to a corrupted git object), the error is only caught after the stream is exhausted. Users might wait a long time for a result that will ultimately fail.
**Recommendation:** Implement a progress callback or a timeout mechanism for `getAllCommits` to provide real-time feedback or early exit on stream errors.

### 3. Concurrency Control

**Location:** `src/aggregate.js`
**Issue:** The `aggregateStreamParallel` function has a hardcoded cap of 8 workers (`Math.min(concurrency, 8)`). While this prevents overwhelming low-memory machines, it is an arbitrary limit.
**Recommendation:** Allow users to specify a `--max-workers` flag or implement dynamic concurrency based on available system memory.

## Medium Priority

### 4. Dashboard Pagination Performance

**Location:** `dashboard/filter.js` & `dashboard/dashboard.js`
**Issue:** Every time a user changes the page in the `Contributors` tab, `getFilteredData()` is called, which re-runs the entire filtering logic (even if the data hasn't changed).
**Recommendation:** Cache the fully filtered/sorted list of contributors in the dashboard state. Pagination should then simply slice this cached list rather than re-triggering the filter/sort pipeline.

### 5. PDF Export Robustness

**Location: `dashboard/dashboard.js`
**Issue:** PDF generation relies on loading three external scripts from a CDN (`html2canvas`, `jspdf`, `jspdf-autotable`) on every click. If the user is offline or the CDN is unreachable, the export fails silently.
**Recommendation:\*\* Pre-load these dependencies or provide a clearer error message (e.0., "PDF export unavailable — check your connection") if the scripts fail to load.

### 6. Slicing Efficiency for Sparse Repos

**Location:** `src/aggregate.js`
**Issue:** The `createYearSlices` function generates fixed 3-month quarters for every year in the range. For repositories with very sparse activity (e.g., one commit every 3 years), this results in many empty tasks being sent to the concurrency pool.
**Recommendation:** Implement a more intelligent slicing strategy that skips years/quarters with no activity, or simplify the slicing logic for repositories spanning short timeframes.

## Low Priority

### 7. CLI Ergonomics

- **Add `--version` flag:** Allow users to check the current version of the installed tool.
- **Add `--stdin` support:** Allow piping git log output directly into the tool (e.g., `git log ... | insights --stdin`).

### 8. Robustness and Tooling

- **RFC 2047 Edge Cases:** Improve `cleanAuthorName` in `src/git.js` to handle folded headers (encoded words split across multiple lines).
- **CI Integration:** Integrate `fallow` (code health analysis) into the GitHub Actions workflow to catch code quality regressions during PRs.

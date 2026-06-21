import { getAllCommits, getCommitYearRange, findActiveYears } from './git.js';
import { cpus } from 'node:os';
import chalk from 'chalk';

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const GITHUB_NOREPLY_RE = /^(?:\d+\+)?([^@+]+)@users\.noreply\.github\.com$/;

/**
 * @typedef {Object} ProcessingState
 * @property {number} totalAdditions
 * @property {number} totalDeletions
 * @property {string|null} firstCommit - ISO date string of the first commit seen
 * @property {string|null} lastCommit - ISO date string of the last commit seen
 * @property {number} commitCount
 * @property {Map<string, DayEntry>} contributionsMap - Keyed by YYYY-MM-DD
 * @property {Map<string, {additions: number, deletions: number}>} frequencyMap - Keyed by YYYY-MM-DD
 * @property {Map<string, ContributorEntry>} contributorsMap - Keyed by email
 * @property {number[]} dayOfWeekCounts - Index 0=Mon … 6=Sun
 * @property {number[]} hourCounts - Index 0-23
 * @property {Map<string, number>} fileChangesMap - Keyed by file path
 *
 * @typedef {Object} DayEntry
 * @property {string} date - YYYY-MM-DD
 * @property {number} count
 * @property {Map<string, AuthorData>} authors - Keyed by email
 * @property {number[]} byHour - Length 24
 * @property {Map<string, number>} files - Keyed by file path
 *
 * @typedef {Object} AuthorData
 * @property {string} name
 * @property {number} count
 * @property {number} additions
 * @property {number} deletions
 *
 * @typedef {Object} ContributorEntry
 * @property {string} name
 * @property {string} email
 * @property {number} totalCommits
 * @property {number} additions
 * @property {number} deletions
 * @property {string} firstCommit
 * @property {string} lastCommit
 * @property {Map<string, number>} names - Keyed by name, value is occurrence count
 */

function extractDate(isoString) {
  return isoString.slice(0, 10);
}

function mapDayOfWeek(jsDay) {
  return (jsDay + 6) % 7;
}

function mergeContributorStats(target, source) {
  target.totalCommits += source.totalCommits;
  target.additions += source.additions;
  target.deletions += source.deletions;
  if (source.firstCommit < target.firstCommit) target.firstCommit = source.firstCommit;
  if (source.lastCommit > target.lastCommit) target.lastCommit = source.lastCommit;
  for (const [name, count] of source.names) {
    target.names.set(name, (target.names.get(name) ?? 0) + count);
  }
}

function makeContributorEntry(c) {
  return {
    name: c.name,
    email: c.email,
    totalCommits: c.totalCommits,
    additions: c.additions,
    deletions: c.deletions,
    firstCommit: c.firstCommit,
    lastCommit: c.lastCommit,
    names: new Map(c.names)
  };
}

function recordTiming(label, t, timings, onTiming) {
  if (!timings) return;
  const elapsed = (performance.now() - t) / 1000;
  timings.push({ label, elapsed });
  if (onTiming) onTiming(label, elapsed);
}

function pickBestName(contributor) {
  let bestName = contributor.name;
  let bestCount = 0;
  for (const [n, count] of contributor.names) {
    if (count > bestCount || (count === bestCount && n < bestName)) {
      bestName = n;
      bestCount = count;
    }
  }
  return bestName;
}

function createEmptyResult(branchCount) {
  return {
    summary: {
      totalCommits: 0,
      totalContributors: 0,
      totalAdditions: 0,
      totalDeletions: 0,
      firstCommit: null,
      lastCommit: null,
      activeBranches: branchCount
    },
    contributions: [],
    contributors: [],
    frequency: [],
    activity: {
      byDayOfWeek: DAY_NAMES.map((day) => ({ day, count: 0 })),
      byHour: Array.from({ length: 24 }, (_, i) => ({ hour: i, count: 0 })),
      topFiles: []
    }
  };
}

function initOrUpdateDayEntry(contributionsMap, dateKey, jsDate, commit) {
  const { name, email } = commit.author;

  let dayEntry = contributionsMap.get(dateKey);
  if (!dayEntry) {
    dayEntry = {
      date: dateKey,
      count: 0,
      authors: new Map(),
      byHour: new Array(24).fill(0),
      files: new Map()
    };
    contributionsMap.set(dateKey, dayEntry);
  }
  dayEntry.count++;
  dayEntry.byHour[jsDate.getUTCHours()]++;
  const prev = dayEntry.authors.get(email) ?? { name, count: 0, additions: 0, deletions: 0 };
  dayEntry.authors.set(email, {
    name,
    count: prev.count + 1,
    additions: prev.additions + (commit.stats?.additions ?? 0),
    deletions: prev.deletions + (commit.stats?.deletions ?? 0)
  });

  return dayEntry;
}

function initOrUpdateContributor(contributorsMap, commit) {
  const { name, email } = commit.author;

  let contributor = contributorsMap.get(email);
  if (!contributor) {
    contributor = {
      name,
      email,
      totalCommits: 0,
      additions: 0,
      deletions: 0,
      firstCommit: commit.date,
      lastCommit: commit.date,
      names: new Map()
    };
    contributorsMap.set(email, contributor);
  }
  contributor.totalCommits++;
  contributor.additions += commit.stats?.additions ?? 0;
  contributor.deletions += commit.stats?.deletions ?? 0;
  contributor.names.set(name, (contributor.names.get(name) ?? 0) + 1);
  const commitDate = new Date(commit.date);
  const firstDate = new Date(contributor.firstCommit);
  const lastDate = new Date(contributor.lastCommit);
  if (commitDate < firstDate) contributor.firstCommit = commit.date;
  if (commitDate > lastDate) contributor.lastCommit = commit.date;

  return contributor;
}

/**
 * Internal helper that processes a single commit and updates all mutable
 * fields on the shared `state` object (totals, per-day contributions, per-author
 * stats, frequency, day-of-week / hour counts, and file-change tracking).
 *
 * Must only be called from within {@link processCommits} (synchronous) or
 * {@link processCommitsStream} (asynchronous).  The `state` object must have
 * been created via {@link createProcessingState}.
 *
 * @param {object} commit - A parsed commit object (see git.js output shape).
 * @param {ProcessingState} state - Mutable processing state from createProcessingState().
 */
function processSingleCommit(commit, state) {
  const dateKey = extractDate(commit.date);
  const jsDate = new Date(commit.date);

  state.commitCount++;
  state.totalAdditions += commit.stats?.additions ?? 0;
  state.totalDeletions += commit.stats?.deletions ?? 0;

  if (state.firstCommit === null || jsDate < new Date(state.firstCommit))
    state.firstCommit = commit.date;
  if (state.lastCommit === null || jsDate > new Date(state.lastCommit))
    state.lastCommit = commit.date;

  const dayEntry = initOrUpdateDayEntry(state.contributionsMap, dateKey, jsDate, commit);

  let freq = state.frequencyMap.get(dateKey);
  if (!freq) {
    freq = { additions: 0, deletions: 0 };
    state.frequencyMap.set(dateKey, freq);
  }
  freq.additions += commit.stats?.additions ?? 0;
  freq.deletions += commit.stats?.deletions ?? 0;

  initOrUpdateContributor(state.contributorsMap, commit);

  state.dayOfWeekCounts[mapDayOfWeek(jsDate.getUTCDay())]++;
  state.hourCounts[jsDate.getUTCHours()]++;

  for (const file of commit.files ?? []) {
    state.fileChangesMap.set(file, (state.fileChangesMap.get(file) ?? 0) + 1);
    dayEntry.files.set(file, (dayEntry.files.get(file) ?? 0) + 1);
  }
}

function createProcessingState() {
  return {
    totalAdditions: 0,
    totalDeletions: 0,
    firstCommit: null,
    lastCommit: null,
    commitCount: 0,
    contributionsMap: new Map(),
    frequencyMap: new Map(),
    contributorsMap: new Map(),
    dayOfWeekCounts: new Array(7).fill(0),
    hourCounts: new Array(24).fill(0),
    fileChangesMap: new Map()
  };
}

function processCommits(commits) {
  const state = createProcessingState();

  for (const commit of commits) {
    processSingleCommit(commit, state);
  }

  return state;
}

async function processCommitsStream(commitsStream) {
  const state = createProcessingState();

  for await (const commit of commitsStream) {
    processSingleCommit(commit, state);
  }

  return state;
}

function findGhNoreplyMerges(contributorsMap, ghUsernameToEmail) {
  const merges = [];
  for (const [email, c] of contributorsMap) {
    if (GITHUB_NOREPLY_RE.test(email)) continue;

    const lowerLocalPart = email.split('@')[0].toLowerCase();
    let matchedTarget = null;

    for (const [name] of c.names) {
      const lowerName = name.toLowerCase();
      if (ghUsernameToEmail.has(lowerName) && ghUsernameToEmail.get(lowerName) !== email) {
        matchedTarget = ghUsernameToEmail.get(lowerName);
        break;
      }
    }

    if (
      !matchedTarget &&
      ghUsernameToEmail.has(lowerLocalPart) &&
      ghUsernameToEmail.get(lowerLocalPart) !== email
    ) {
      matchedTarget = ghUsernameToEmail.get(lowerLocalPart);
    }

    if (matchedTarget) {
      merges.push({ sourceEmail: email, targetEmail: matchedTarget });
    }
  }
  return merges;
}

function applyGhNoreplyMerges(contributorsMap, contributionsMap, merges) {
  for (const { sourceEmail, targetEmail } of merges) {
    const target = contributorsMap.get(targetEmail);
    const source = contributorsMap.get(sourceEmail);
    if (!target || !source) continue;

    mergeContributorStats(target, source);
    contributorsMap.delete(sourceEmail);
  }

  for (const { targetEmail, sourceEmail } of merges) {
    const targetContributor = contributorsMap.get(targetEmail);
    if (!targetContributor) continue;

    for (const dayEntry of contributionsMap.values()) {
      if (!dayEntry.authors.has(sourceEmail)) continue;

      const sourceData = dayEntry.authors.get(sourceEmail);
      dayEntry.authors.delete(sourceEmail);

      if (dayEntry.authors.has(targetEmail)) {
        const existing = dayEntry.authors.get(targetEmail);
        existing.count += sourceData.count;
        existing.additions += sourceData.additions;
        existing.deletions += sourceData.deletions;
      } else {
        dayEntry.authors.set(targetEmail, {
          name: pickBestName(targetContributor),
          count: sourceData.count,
          additions: sourceData.additions,
          deletions: sourceData.deletions
        });
      }
    }
  }
}

function mergeNoreplyContributors(contributorsMap, contributionsMap) {
  const ghUsernameToEmail = new Map();
  for (const [email] of contributorsMap) {
    const m = GITHUB_NOREPLY_RE.exec(email);
    if (m) ghUsernameToEmail.set(m[1].toLowerCase(), email);
  }

  if (ghUsernameToEmail.size === 0) return;

  const merges = findGhNoreplyMerges(contributorsMap, ghUsernameToEmail);
  applyGhNoreplyMerges(contributorsMap, contributionsMap, merges);
}

function formatResults(processed, commitCount, branchCount) {
  const {
    contributionsMap,
    frequencyMap,
    contributorsMap,
    dayOfWeekCounts,
    hourCounts,
    fileChangesMap,
    totalAdditions,
    totalDeletions,
    firstCommit,
    lastCommit
  } = processed;

  const byDate = (a, b) => a.date.localeCompare(b.date);

  const contributions = Array.from(contributionsMap.values())
    .map((day) => ({
      date: day.date,
      count: day.count,
      byHour: Array.from(day.byHour, (count, hour) => ({ hour, count })),
      topFiles: Array.from(day.files.entries())
        .map(([path, changes]) => ({ path, changes }))
        .sort((a, b) => b.changes - a.changes || a.path.localeCompare(b.path))
        .slice(0, 20),
      authorDetails: Array.from(day.authors.entries())
        .map(([email, { name, count, additions, deletions }]) => ({
          author: name,
          email,
          count,
          additions,
          deletions
        }))
        .sort((a, b) => b.count - a.count || a.author.localeCompare(b.author))
    }))
    .sort(byDate);

  const contributors = Array.from(contributorsMap.values())
    .map((c) => {
      const bestName = pickBestName(c);
      return {
        name: bestName,
        email: c.email,
        totalCommits: c.totalCommits,
        additions: c.additions,
        deletions: c.deletions,
        firstCommit: c.firstCommit,
        lastCommit: c.lastCommit
      };
    })
    .sort((a, b) => b.totalCommits - a.totalCommits || a.name.localeCompare(b.name));

  const frequency = Array.from(frequencyMap.entries())
    .map(([date, { additions, deletions }]) => ({ date, additions, deletions }))
    .sort(byDate);

  const topFiles = Array.from(fileChangesMap.entries())
    .map(([path, changes]) => ({ path, changes }))
    .sort((a, b) => b.changes - a.changes || a.path.localeCompare(b.path))
    .slice(0, 30);

  return {
    summary: {
      totalCommits: commitCount,
      totalContributors: contributorsMap.size,
      totalAdditions,
      totalDeletions,
      firstCommit,
      lastCommit,
      activeBranches: branchCount
    },
    contributions,
    contributors,
    frequency,
    activity: {
      byDayOfWeek: DAY_NAMES.map((day, i) => ({ day, count: dayOfWeekCounts[i] })),
      byHour: Array.from(hourCounts, (count, hour) => ({ hour, count })),
      topFiles
    }
  };
}

function cloneDayEntry(entry) {
  const authors = new Map();
  for (const [email, author] of entry.authors) {
    authors.set(email, { ...author });
  }
  const files = new Map(entry.files);
  return {
    date: entry.date,
    count: entry.count,
    authors,
    byHour: [...entry.byHour],
    files
  };
}

function mergeDayEntries(aEntry, bEntry) {
  for (const [email, bAuthor] of bEntry.authors) {
    const existing = aEntry.authors.get(email);
    if (existing) {
      existing.count += bAuthor.count;
      existing.additions += bAuthor.additions;
      existing.deletions += bAuthor.deletions;
    } else {
      aEntry.authors.set(email, { ...bAuthor });
    }
  }

  for (const [file, count] of bEntry.files) {
    aEntry.files.set(file, (aEntry.files.get(file) ?? 0) + count);
  }

  aEntry.count += bEntry.count;
  aEntry.byHour = aEntry.byHour.map((v, i) => v + bEntry.byHour[i]);
}

function mergeFrequencyMaps(aFreqMap, bFreqMap) {
  const frequencyMap = new Map();
  for (const [date, freq] of aFreqMap) {
    frequencyMap.set(date, { ...freq });
  }
  for (const [date, bFreq] of bFreqMap) {
    const aFreq = frequencyMap.get(date);
    if (aFreq) {
      aFreq.additions += bFreq.additions;
      aFreq.deletions += bFreq.deletions;
    } else {
      frequencyMap.set(date, { ...bFreq });
    }
  }
  return frequencyMap;
}

function pickFirstCommit(a, b) {
  if (a === null) return b;
  if (b === null) return a;
  if (new Date(a) < new Date(b)) return a;
  return b;
}

function pickLastCommit(a, b) {
  if (a === null) return b;
  if (b === null) return a;
  if (new Date(a) > new Date(b)) return a;
  return b;
}

function mergeMap(sourceA, sourceB, init, merge) {
  const map = new Map();
  for (const [key, val] of sourceA) map.set(key, init(val));
  for (const [key, val] of sourceB) {
    const existing = map.get(key);
    if (existing) {
      merge(existing, val);
    } else {
      map.set(key, init(val));
    }
  }
  return map;
}

function mergeProcessingState(a, b) {
  const contributionsMap = mergeMap(
    a.contributionsMap,
    b.contributionsMap,
    cloneDayEntry,
    mergeDayEntries
  );

  const frequencyMap = mergeFrequencyMaps(a.frequencyMap, b.frequencyMap);

  const contributorsMap = mergeMap(
    a.contributorsMap,
    b.contributorsMap,
    makeContributorEntry,
    mergeContributorStats
  );

  const firstCommit = pickFirstCommit(a.firstCommit, b.firstCommit);
  const lastCommit = pickLastCommit(a.lastCommit, b.lastCommit);

  const fileChangesMap = new Map();
  for (const [file, count] of a.fileChangesMap) {
    fileChangesMap.set(file, count);
  }
  for (const [file, count] of b.fileChangesMap) {
    fileChangesMap.set(file, (fileChangesMap.get(file) ?? 0) + count);
  }

  return {
    totalAdditions: a.totalAdditions + b.totalAdditions,
    totalDeletions: a.totalDeletions + b.totalDeletions,
    firstCommit,
    lastCommit,
    commitCount: a.commitCount + b.commitCount,
    contributionsMap,
    frequencyMap,
    contributorsMap,
    dayOfWeekCounts: a.dayOfWeekCounts.map((v, i) => v + b.dayOfWeekCounts[i]),
    hourCounts: a.hourCounts.map((v, i) => v + b.hourCounts[i]),
    fileChangesMap
  };
}

function mergeAllStates(states) {
  if (states.length === 0) return createProcessingState();
  if (states.length === 1) return states[0];
  return states.reduce(mergeProcessingState);
}

function finalizeResults(processed, commitCount, bc, timings, onTiming) {
  if (commitCount === 0) return createEmptyResult(bc);

  if (processed.contributorsMap.size > 0) {
    const t = performance.now();
    mergeNoreplyContributors(processed.contributorsMap, processed.contributionsMap);
    recordTiming('Merge contributors', t, timings, onTiming);
  }

  const t = performance.now();
  const result = formatResults(processed, commitCount, bc);
  recordTiming('Format results', t, timings, onTiming);
  return result;
}

export async function concurrencyPool(tasks, limit) {
  const results = new Array(tasks.length);
  let index = 0;

  async function worker() {
    while (index < tasks.length) {
      const i = index++;
      results[i] = await tasks[i]();
    }
  }

  const active = Math.min(limit, tasks.length);
  const workers = Array.from({ length: active }, () => worker());
  await Promise.all(workers);
  return results;
}

export function aggregate(commits, branchCount) {
  if (commits.length === 0) return createEmptyResult(branchCount);
  const processed = processCommits(commits);
  if (processed.contributorsMap.size > 0) {
    mergeNoreplyContributors(processed.contributorsMap, processed.contributionsMap);
  }
  return formatResults(processed, processed.commitCount, branchCount);
}

export async function aggregateStream(commitsStream, branchCount, timings, onTiming) {
  let t = performance.now();
  const [processed, bc] = await Promise.all([
    processCommitsStream(commitsStream),
    Promise.resolve(branchCount)
  ]);
  recordTiming('Parse commits', t, timings, onTiming);

  return finalizeResults(processed, processed.commitCount, bc, timings, onTiming);
}

export function createYearSlices(firstYear, lastYear, activeYears = null) {
  const slices = [];
  const QUARTER_MONTHS = 3;
  for (let year = firstYear; year <= lastYear; year++) {
    if (activeYears && !activeYears.has(year)) continue;
    for (let quarter = 0; quarter < 12; quarter += QUARTER_MONTHS) {
      const startMonth = quarter;
      const endMonth = quarter + QUARTER_MONTHS;
      slices.push({
        after: `${year}-${String(startMonth + 1).padStart(2, '0')}-01`,
        before:
          endMonth === 12
            ? `${year + 1}-01-01`
            : `${year}-${String(endMonth + 1).padStart(2, '0')}-01`,
        quarterNum: quarter / QUARTER_MONTHS + 1
      });
    }
  }
  return slices;
}

/**
 * Process commits in parallel by slicing the repo's history into quarters
 * and farming each slice out to a concurrency pool.
 *
 * @param {string}      repoPath     - Path to the git repository.
 * @param {number|Promise<number>} branchCount - Number of local branches (or a promise resolving to one).
 * @param {Array}       [timings]    - Optional array to receive timing entries.
 * @param {Function}    [onTiming]   - Optional callback invoked with each timing entry.
 * @param {object}      [options]    - Options bag (last positional parameter).
 * @param {boolean}     [options.noMerges] - If true, exclude merge commits.
 * @param {number}      [options.concurrency] - Max parallel workers. Defaults to CPU count (max 8).
 */
export async function aggregateStreamParallel(
  repoPath,
  branchCount,
  timings,
  onTiming,
  options = {}
) {
  const { firstYear, lastYear } = await getCommitYearRange(repoPath);
  if (firstYear === null || lastYear === null) {
    console.warn(
      chalk.yellow(
        `could not determine commit year range for ${repoPath}. the dashboard will show an empty state.`
      )
    );
    const bc = await branchCount;
    return createEmptyResult(bc);
  }

  let activeYears = null;
  if (lastYear - firstYear > 2) {
    activeYears = await findActiveYears(repoPath, firstYear, lastYear);
  }

  // Create slices for all years in the range
  const slices = createYearSlices(firstYear, lastYear, activeYears);

  const yearQuarterCount = new Map();
  const yearWallStart = new Map();
  let nextYear = firstYear;

  const tasks = slices.map((slice) => async () => {
    const year = slice.after.slice(0, 4);
    if (timings && !yearWallStart.has(year)) {
      yearWallStart.set(year, performance.now());
    }
    try {
      const state = await processCommitsStream(
        getAllCommits(repoPath, {
          after: slice.after,
          before: slice.before,
          noMerges: options.noMerges
        })
      );
      if (timings) {
        const qCount = (yearQuarterCount.get(year) ?? 0) + 1;
        yearQuarterCount.set(year, qCount);

        if (qCount === 4) {
          while (nextYear <= lastYear && yearQuarterCount.get(String(nextYear)) === 4) {
            const start = yearWallStart.get(String(nextYear)) ?? performance.now();
            const label = `Parse commits (${nextYear})`;
            const elapsed = (performance.now() - start) / 1000;
            timings.push({ label, elapsed });
            if (onTiming) onTiming(label, elapsed);
            nextYear++;
          }
        }
      }
      return state;
    } catch (err) {
      throw new Error(
        `failed to process commits for ${year} Q${slice.quarterNum} (${slice.after} to ${slice.before}): ${err.message}`,
        { cause: err }
      );
    }
  });

  const concurrency = options.concurrency ?? (cpus().length || 1);
  const states = await concurrencyPool(tasks, Math.min(concurrency, 8));

  let t = performance.now();
  const processed = mergeAllStates(states);
  recordTiming('Merge results', t, timings, onTiming);

  const bc = await branchCount;
  return finalizeResults(processed, processed.commitCount, bc, timings, onTiming);
}

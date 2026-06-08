const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const GITHUB_NOREPLY_RE = /^(?:\d+\+)?([^@+]+)@users\.noreply\.github\.com$/;

function extractDate(isoString) {
  return isoString.slice(0, 10);
}

function mapDayOfWeek(jsDay) {
  return (jsDay + 6) % 7;
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
      activeBranches: branchCount,
    },
    contributions: [],
    contributors: [],
    frequency: [],
    activity: {
      byDayOfWeek: DAY_NAMES.map((day) => ({ day, count: 0 })),
      byHour: Array.from({ length: 24 }, (_, i) => ({ hour: i, count: 0 })),
      topFiles: [],
    },
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
      files: new Map(),
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
    deletions: prev.deletions + (commit.stats?.deletions ?? 0),
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
      names: new Map(),
    };
    contributorsMap.set(email, contributor);
  }
  contributor.totalCommits++;
  contributor.additions += commit.stats?.additions ?? 0;
  contributor.deletions += commit.stats?.deletions ?? 0;
  contributor.names.set(name, (contributor.names.get(name) ?? 0) + 1);
  if (commit.date < contributor.firstCommit) contributor.firstCommit = commit.date;
  if (commit.date > contributor.lastCommit) contributor.lastCommit = commit.date;

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
 * @param {object} state  - Mutable processing state from createProcessingState().
 */
function processSingleCommit(commit, state) {
  const dateKey = extractDate(commit.date);
  const jsDate = new Date(commit.date);

  state.commitCount++;
  state.totalAdditions += commit.stats?.additions ?? 0;
  state.totalDeletions += commit.stats?.deletions ?? 0;

  if (state.firstCommit === null || commit.date < state.firstCommit)
    state.firstCommit = commit.date;
  if (state.lastCommit === null || commit.date > state.lastCommit) state.lastCommit = commit.date;

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
    fileChangesMap: new Map(),
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

    target.totalCommits += source.totalCommits;
    target.additions += source.additions;
    target.deletions += source.deletions;
    if (source.firstCommit < target.firstCommit) target.firstCommit = source.firstCommit;
    if (source.lastCommit > target.lastCommit) target.lastCommit = source.lastCommit;
    for (const [name, count] of source.names) {
      target.names.set(name, (target.names.get(name) ?? 0) + count);
    }
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
        let bestName = targetContributor.name;
        let bestCount = 0;
        for (const [n, count] of targetContributor.names) {
          if (count > bestCount || (count === bestCount && n < bestName)) {
            bestName = n;
            bestCount = count;
          }
        }
        dayEntry.authors.set(targetEmail, {
          name: bestName,
          count: sourceData.count,
          additions: sourceData.additions,
          deletions: sourceData.deletions,
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
    lastCommit,
  } = processed;

  const byDate = (a, b) => a.date.localeCompare(b.date);

  const contributions = Array.from(contributionsMap.values())
    .map((day) => ({
      date: day.date,
      count: day.count,
      byHour: Array.from(day.byHour, (count, hour) => ({ hour, count })),
      topFiles: Array.from(day.files.entries())
        .map(([path, changes]) => ({ path, changes }))
        .sort((a, b) => b.changes - a.changes || a.path.localeCompare(b.path)),
      authorDetails: Array.from(day.authors.entries())
        .map(([email, { name, count, additions, deletions }]) => ({
          author: name,
          email,
          count,
          additions,
          deletions,
        }))
        .sort((a, b) => b.count - a.count || a.author.localeCompare(b.author)),
    }))
    .sort(byDate);

  const contributors = Array.from(contributorsMap.values())
    .map((c) => {
      let bestName = c.name;
      let bestCount = 0;
      for (const [n, count] of c.names) {
        if (count > bestCount || (count === bestCount && n < bestName)) {
          bestName = n;
          bestCount = count;
        }
      }
      return {
        name: bestName,
        email: c.email,
        totalCommits: c.totalCommits,
        additions: c.additions,
        deletions: c.deletions,
        firstCommit: c.firstCommit,
        lastCommit: c.lastCommit,
      };
    })
    .sort((a, b) => b.totalCommits - a.totalCommits || a.name.localeCompare(b.name));

  const frequency = Array.from(frequencyMap.entries())
    .map(([date, { additions, deletions }]) => ({ date, additions, deletions }))
    .sort(byDate);

  const topFiles = Array.from(fileChangesMap.entries())
    .map(([path, changes]) => ({ path, changes }))
    .sort((a, b) => b.changes - a.changes || a.path.localeCompare(b.path))
    .slice(0, 20);

  return {
    summary: {
      totalCommits: commitCount,
      totalContributors: contributorsMap.size,
      totalAdditions,
      totalDeletions,
      firstCommit,
      lastCommit,
      activeBranches: branchCount,
    },
    contributions,
    contributors,
    frequency,
    activity: {
      byDayOfWeek: DAY_NAMES.map((day, i) => ({ day, count: dayOfWeekCounts[i] })),
      byHour: Array.from(hourCounts, (count, hour) => ({ hour, count })),
      topFiles,
    },
  };
}

export function aggregate(commits, branchCount) {
  if (commits.length === 0) return createEmptyResult(branchCount);
  const processed = processCommits(commits);
  if (processed.contributorsMap.size > 0) {
    mergeNoreplyContributors(processed.contributorsMap, processed.contributionsMap);
  }
  return formatResults(processed, processed.commitCount, branchCount);
}

export async function aggregateStream(commitsStream, branchCount, timings) {
  let t = performance.now();
  const [processed, bc] = await Promise.all([processCommitsStream(commitsStream), branchCount]);
  if (timings) timings.push({ label: 'Parse commits', elapsed: (performance.now() - t) / 1000 });

  const commitCount = processed.commitCount;

  if (commitCount === 0) return createEmptyResult(bc);
  if (processed.contributorsMap.size > 0) {
    t = performance.now();
    mergeNoreplyContributors(processed.contributorsMap, processed.contributionsMap);
    if (timings)
      timings.push({ label: 'Merge contributors', elapsed: (performance.now() - t) / 1000 });
  }
  t = performance.now();
  const result = formatResults(processed, commitCount, bc);
  if (timings) timings.push({ label: 'Format results', elapsed: (performance.now() - t) / 1000 });
  return result;
}

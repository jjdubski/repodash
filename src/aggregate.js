const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

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

function processCommits(commits) {
  let totalAdditions = 0;
  let totalDeletions = 0;
  let firstCommit = commits[0].date;
  let lastCommit = commits[0].date;

  const contributionsMap = new Map();
  const frequencyMap = new Map();
  const contributorsMap = new Map();

  const dayOfWeekCounts = new Array(7).fill(0);
  const hourCounts = new Array(24).fill(0);

  const fileChangesMap = new Map();

  for (const commit of commits) {
    const { name, email } = commit.author;
    const dateKey = extractDate(commit.date);
    const jsDate = new Date(commit.date);

    totalAdditions += commit.stats?.additions ?? 0;
    totalDeletions += commit.stats?.deletions ?? 0;
    if (commit.date < firstCommit) firstCommit = commit.date;
    if (commit.date > lastCommit) lastCommit = commit.date;

    let dayEntry = contributionsMap.get(dateKey);
    if (!dayEntry) {
      dayEntry = { date: dateKey, count: 0, authors: new Map(), byHour: new Array(24).fill(0), files: new Map() };
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

    let freq = frequencyMap.get(dateKey);
    if (!freq) {
      freq = { additions: 0, deletions: 0 };
      frequencyMap.set(dateKey, freq);
    }
    freq.additions += commit.stats?.additions ?? 0;
    freq.deletions += commit.stats?.deletions ?? 0;

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

    dayOfWeekCounts[mapDayOfWeek(jsDate.getUTCDay())]++;
    hourCounts[jsDate.getUTCHours()]++;

    for (const file of commit.files ?? []) {
      fileChangesMap.set(file, (fileChangesMap.get(file) ?? 0) + 1);
      dayEntry.files.set(file, (dayEntry.files.get(file) ?? 0) + 1);
    }
  }

  return {
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
  };
}

function mergeNoreplyContributors(contributorsMap, contributionsMap) {
  const GITHUB_NOREPLY_RE = /^(?:\d+\+)?([^@+]+)@users\.noreply\.github\.com$/;

  const ghUsernameToEmail = new Map();
  for (const [email] of contributorsMap) {
    const m = GITHUB_NOREPLY_RE.exec(email);
    if (m) ghUsernameToEmail.set(m[1].toLowerCase(), email);
  }

  if (ghUsernameToEmail.size === 0) return;

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

    if (!matchedTarget && ghUsernameToEmail.has(lowerLocalPart) && ghUsernameToEmail.get(lowerLocalPart) !== email) {
      matchedTarget = ghUsernameToEmail.get(lowerLocalPart);
    }

    if (matchedTarget) {
      merges.push({ sourceEmail: email, targetEmail: matchedTarget });
    }
  }

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

  const contributions = Array.from(contributionsMap.values())
    .map((day) => ({
      date: day.date,
      count: day.count,
      byHour: Array.from(day.byHour, (count, hour) => ({ hour, count })),
      topFiles: Array.from(day.files.entries())
        .map(([path, changes]) => ({ path, changes }))
        .sort((a, b) => b.changes - a.changes || a.path.localeCompare(b.path)),
      authorDetails: Array.from(day.authors.entries())
        .map(([email, { name, count, additions, deletions }]) => ({ author: name, email, count, additions, deletions }))
        .sort((a, b) => b.count - a.count || a.author.localeCompare(b.author)),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

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
    .sort((a, b) => a.date.localeCompare(b.date));

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
  return formatResults(processed, commits.length, branchCount);
}

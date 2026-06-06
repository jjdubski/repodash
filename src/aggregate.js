const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * Extract the date portion (YYYY-MM-DD) from an ISO 8601 string.
 * Git's %ai format always produces ISO 8601, so slice(0,10) reliably
 * yields the YYYY-MM-DD prefix.
 * @param {string} isoString
 * @returns {string}
 */
function extractDate(isoString) {
  return isoString.slice(0, 10);
}

/**
 * Map a JavaScript getDay() / getUTCDay() value (0=Sun) to our
 * Mon-Sun index.  Day-of-week charts render Mon first.
 * @param {number} jsDay - 0=Sun .. 6=Sat
 * @returns {number} 0=Mon .. 6=Sun
 */
function mapDayOfWeek(jsDay) {
  return (jsDay + 6) % 7;
}

/**
 * Transform raw commit data into the five dashboard datasets.
 *
 * Pure function — no side effects, no I/O.
 *
 * @param {Array} commits - Parsed commit objects from getAllCommits()
 * @param {number} branchCount - Number of local branches
 * @returns {object} { summary, contributions, contributors, frequency, activity }
 */
export function aggregate(commits, branchCount) {
  // ---- empty-repo shortcut ------------------------------------------------
  if (commits.length === 0) {
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

  // ---- single-pass accumulators -------------------------------------------

  let totalAdditions = 0;
  let totalDeletions = 0;
  let firstCommit = commits[0].date;
  let lastCommit = commits[0].date;

  // date key → { date, count, authors: Map<email, { name, count, additions, deletions }> }
  const contributionsMap = new Map();

  // date key → { additions, deletions }
  const frequencyMap = new Map();

  // email → { name, email, totalCommits, additions, deletions, firstCommit, lastCommit, names }
  const contributorsMap = new Map();

  const dayOfWeekCounts = new Array(7).fill(0); // index: Mon-Sun
  const hourCounts = new Array(24).fill(0);

  // file path → change count
  const fileChangesMap = new Map();

  for (const commit of commits) {
    const { name, email } = commit.author;
    const dateKey = extractDate(commit.date);
    const jsDate = new Date(commit.date);

    // -- summary totals -----------------------------------------------------
    totalAdditions += commit.stats?.additions ?? 0;
    totalDeletions += commit.stats?.deletions ?? 0;
    if (commit.date < firstCommit) firstCommit = commit.date;
    if (commit.date > lastCommit) lastCommit = commit.date;

    // -- contributions (per-day, per-author) --------------------------------
    let dayEntry = contributionsMap.get(dateKey);
    if (!dayEntry) {
      dayEntry = { date: dateKey, count: 0, authors: new Map() };
      contributionsMap.set(dateKey, dayEntry);
    }
    dayEntry.count++;
    const prev = dayEntry.authors.get(email) ?? { name, count: 0, additions: 0, deletions: 0 };
    dayEntry.authors.set(email, {
      name,
      count: prev.count + 1,
      additions: prev.additions + (commit.stats?.additions ?? 0),
      deletions: prev.deletions + (commit.stats?.deletions ?? 0),
    });

    // -- frequency (additions / deletions per day) --------------------------
    let freq = frequencyMap.get(dateKey);
    if (!freq) {
      freq = { additions: 0, deletions: 0 };
      frequencyMap.set(dateKey, freq);
    }
    freq.additions += commit.stats?.additions ?? 0;
    freq.deletions += commit.stats?.deletions ?? 0;

    // -- contributors -------------------------------------------------------
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

    // -- activity patterns --------------------------------------------------
    dayOfWeekCounts[mapDayOfWeek(jsDate.getUTCDay())]++;
    hourCounts[jsDate.getUTCHours()]++;

    // -- top files ----------------------------------------------------------
    for (const file of commit.files ?? []) {
      fileChangesMap.set(file, (fileChangesMap.get(file) ?? 0) + 1);
    }
  }

  // ---- GitHub noreply email handling ---------------------------------------
  // Merge contributors where the same person uses both a normal email and a
  // GitHub noreply email (user@users.noreply.github.com).  The local part of
  // the noreply address IS the GitHub username (with optional numeric ID+
  // prefix); if another contributor's name or email local part matches that
  // username they are the same person.

  const GITHUB_NOREPLY_RE = /^(?:\d+\+)?([^@+]+)@users\.noreply\.github\.com$/;

  // Store GH usernames lowercased for case-insensitive matching.
  // GitHub always lowercases the local part of noreply addresses,
  // but the author name in commits may be "Jake" vs "jake".
  const ghUsernameToEmail = new Map();
  for (const [email] of contributorsMap) {
    const m = GITHUB_NOREPLY_RE.exec(email);
    if (m) ghUsernameToEmail.set(m[1].toLowerCase(), email);
  }

  if (ghUsernameToEmail.size > 0) {
    // Find merge pairs: { sourceEmail, targetEmail, sourceNames }
    const merges = [];
    for (const [email, c] of contributorsMap) {
      if (GITHUB_NOREPLY_RE.test(email)) continue;

      const lowerLocalPart = email.split('@')[0].toLowerCase();
      let matchedTarget = null;

      // Check 1: any of this contributor's names (case-insensitive) matches a known GH username
      for (const [name] of c.names) {
        const lowerName = name.toLowerCase();
        if (ghUsernameToEmail.has(lowerName) && ghUsernameToEmail.get(lowerName) !== email) {
          matchedTarget = ghUsernameToEmail.get(lowerName);
          break;
        }
      }

      // Check 2: the email's local part (case-insensitive) matches a known GH username
      if (!matchedTarget && ghUsernameToEmail.has(lowerLocalPart) && ghUsernameToEmail.get(lowerLocalPart) !== email) {
        matchedTarget = ghUsernameToEmail.get(lowerLocalPart);
      }

      if (matchedTarget) {
        merges.push({ sourceEmail: email, targetEmail: matchedTarget });
      }
    }

    // Apply merges to contributorsMap
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

    // Apply merges to contributionsMap (source email → target email)
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

  // ---- convert Maps to sorted arrays --------------------------------------

  // Contributions: sort by date ascending; authorDetails sorted by count desc
  const contributions = Array.from(contributionsMap.values())
    .map((day) => ({
      date: day.date,
      count: day.count,
      authorDetails: Array.from(day.authors.entries())
        .map(([email, { name, count, additions, deletions }]) => ({ author: name, email, count, additions, deletions }))
        .sort((a, b) => b.count - a.count || a.author.localeCompare(b.author)),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Contributors: sort by total commits descending, then by name
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

  // Frequency: sort by date ascending
  const frequency = Array.from(frequencyMap.entries())
    .map(([date, { additions, deletions }]) => ({ date, additions, deletions }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Activity: top 10 files by change count descending
  const topFiles = Array.from(fileChangesMap.entries())
    .map(([path, changes]) => ({ path, changes }))
    .sort((a, b) => b.changes - a.changes || a.path.localeCompare(b.path))
    .slice(0, 10);

  // ---- assemble result ----------------------------------------------------

  return {
    summary: {
      totalCommits: commits.length,
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

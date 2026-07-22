'use strict';

export const MAX_CHART_POINTS = 500;

export function formatNumber(n) {
  if (n == null || Number.isNaN(n)) return '\u2014';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1000000) return sign + (abs / 1000000).toFixed(1) + 'M';
  if (abs >= 1000) return sign + (abs / 1000).toFixed(1) + 'K';
  return String(n);
}

export function formatDate(iso) {
  if (!iso) return '\u2014';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

export function clampDate(dateStr, minStr, maxStr) {
  if (!dateStr) return dateStr;
  if (minStr && dateStr < minStr) return minStr;
  if (maxStr && dateStr > maxStr) return maxStr;
  return dateStr;
}

export function getCutoffDate(filter, customStartDate, customEndDate) {
  if (filter === 'custom') {
    return {
      start: customStartDate || null,
      end: customEndDate || null
    };
  }
  const now = new Date();
  const d = new Date(now);
  switch (filter) {
    case 'thisWeek':
      d.setDate(now.getDate() - 7);
      break;
    case 'last3months':
      d.setMonth(now.getMonth() - 3);
      break;
    case 'pastYear':
      d.setFullYear(now.getFullYear() - 1);
      break;
    default:
      return null;
  }
  return { start: d.toISOString().slice(0, 10), end: null };
}

export function filterByDate(arr, bounds, field = 'date') {
  if (!arr?.length || !bounds) return arr;
  return arr.filter(function (item) {
    if (bounds.start && item[field] < bounds.start) return false;
    if (bounds.end && item[field] > bounds.end) return false;
    return true;
  });
}

export function downsampleData(arr, maxPoints) {
  if (!arr || arr.length <= maxPoints) return arr;
  if (maxPoints <= 1) return [arr[0]];
  const step = (arr.length - 1) / (maxPoints - 1);
  const result = [];
  for (let i = 0; i < maxPoints; i++) {
    result.push(arr[Math.round(i * step)]);
  }
  return result;
}

export function computeFilteredSummary(contributions, frequency) {
  const totalCommits = contributions.reduce(function (sum, d) {
    return sum + d.count;
  }, 0);
  const totalAdditions = frequency.reduce(function (sum, d) {
    return sum + d.additions;
  }, 0);
  const totalDeletions = frequency.reduce(function (sum, d) {
    return sum + d.deletions;
  }, 0);

  const authorSet = {};
  contributions.forEach(function (day) {
    (day.authorDetails || []).forEach(function (a) {
      authorSet[a.email || a.author] = true;
    });
  });
  const totalContributors = Object.keys(authorSet).length;

  let firstDate = null;
  let lastDate = null;
  for (const c of contributions) {
    if (c.date) {
      if (!firstDate || c.date < firstDate) firstDate = c.date;
      if (!lastDate || c.date > lastDate) lastDate = c.date;
    }
  }

  return {
    totalCommits,
    totalContributors,
    totalAdditions,
    totalDeletions,
    firstCommit: firstDate,
    lastCommit: lastDate
  };
}

export function computeFilteredContributors(contributions, allContributors) {
  const authorStats = {};
  contributions.forEach(function (day) {
    (day.authorDetails || []).forEach(function (a) {
      const key = a.email || a.author;
      if (!authorStats[key]) {
        authorStats[key] = {
          totalCommits: 0,
          additions: 0,
          deletions: 0
        };
      }
      authorStats[key].totalCommits += a.count;
      authorStats[key].additions += a.additions;
      authorStats[key].deletions += a.deletions;
    });
  });

  return allContributors
    .filter(function (c) {
      return Object.hasOwn(authorStats, c.email);
    })
    .map(function (c) {
      const stats = authorStats[c.email] || {
        totalCommits: 0,
        additions: 0,
        deletions: 0
      };
      return {
        name: c.name,
        email: c.email,
        totalCommits: stats.totalCommits,
        additions: stats.additions,
        deletions: stats.deletions,
        firstCommit: c.firstCommit,
        lastCommit: c.lastCommit
      };
    })
    .sort(function (a, b) {
      return b.totalCommits - a.totalCommits || (a.name || '').localeCompare(b.name || '');
    });
}

export function computeFilteredActivity(contributions) {
  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const dayCounts = [0, 0, 0, 0, 0, 0, 0];
  const hourCounts = new Array(24).fill(0);
  const fileMap = {};

  for (const c of contributions) {
    const jsDay = new Date(c.date + 'T00:00:00Z').getUTCDay();
    dayCounts[(jsDay + 6) % 7] += c.count;

    if (c.byHour) {
      for (let h = 0; h < c.byHour.length; h++) {
        hourCounts[h] += c.byHour[h].count;
      }
    }

    if (c.topFiles) {
      for (const f of c.topFiles) {
        fileMap[f.path] = (fileMap[f.path] || 0) + f.changes;
      }
    }
  }

  const byDayOfWeek = dayNames.map(function (day, i) {
    return { day, count: dayCounts[i] };
  });

  const byHour = hourCounts.map(function (count, hour) {
    return { hour, count };
  });

  const topFiles = Object.keys(fileMap)
    .map(function (path) {
      return { path, changes: fileMap[path] };
    })
    .sort(function (a, b) {
      return b.changes - a.changes || a.path.localeCompare(b.path);
    })
    .slice(0, 30);

  return {
    byDayOfWeek,
    byHour,
    topFiles
  };
}

export function sortContributors(contributors, sortBy, sortOrder) {
  const fieldMap = { commits: 'totalCommits' };
  const field = fieldMap[sortBy] || sortBy;
  return [...contributors].sort(function (a, b) {
    let cmp;
    if (typeof a[field] === 'string') {
      cmp = (a[field] || '').localeCompare(b[field] || '');
    } else {
      cmp = (a[field] || 0) - (b[field] || 0);
    }
    if (cmp === 0 && sortBy !== 'name') {
      cmp = (a.name || '').localeCompare(b.name || '');
    }
    return sortOrder === 'asc' ? cmp : -cmp;
  });
}

export function getAvailableYears(contributions) {
  const yearSet = {};
  const yearList = [];
  for (let i = 0; i < contributions.length; i++) {
    const y = contributions[i].date.slice(0, 4);
    if (/^\d{4}$/.test(y) && !yearSet[y]) {
      yearSet[y] = true;
      yearList.push(y);
    }
  }
  yearList.sort(function (a, b) {
    return b - a;
  });
  return ['pastYear'].concat(yearList);
}

export function getAuthorCommitCounts(contributions, email) {
  const result = [];
  for (let i = 0; i < contributions.length; i++) {
    const c = contributions[i];
    let total = 0;
    if (c.authorDetails) {
      for (let j = 0; j < c.authorDetails.length; j++) {
        if (c.authorDetails[j].email === email) {
          total += c.authorDetails[j].count;
        }
      }
    }
    if (total > 0) {
      result.push({ date: c.date, count: total });
    }
  }
  return result;
}

export function computeAuthorTotals(contributions, contributors) {
  const emailTotals = {};
  for (let i = 0; i < contributions.length; i++) {
    const c = contributions[i];
    if (c.authorDetails) {
      for (let j = 0; j < c.authorDetails.length; j++) {
        const a = c.authorDetails[j];
        const key = a.email;
        if (!emailTotals[key]) {
          emailTotals[key] = 0;
        }
        emailTotals[key] += a.count;
      }
    }
  }
  const nameMap = {};
  if (contributors) {
    for (let i = 0; i < contributors.length; i++) {
      nameMap[contributors[i].email] = contributors[i].name;
    }
  }
  const result = [];
  const emails = Object.keys(emailTotals);
  for (let i = 0; i < emails.length; i++) {
    const email = emails[i];
    result.push({
      email: email,
      name: nameMap[email] || email,
      totalCommits: emailTotals[email]
    });
  }
  result.sort(function (a, b) {
    return b.totalCommits - a.totalCommits || a.email.localeCompare(b.email);
  });
  return result;
}

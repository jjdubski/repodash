/**
 * Escapes and quotes a CSV field value if it contains commas, quotes, or newlines.
 *
 * @param {string} value - The raw field value
 * @returns {string} The safe CSV field value
 */
function csvField(value) {
  if (value === null || value === undefined) return '';
  let str = String(value);
  if (/^[=+\-@]/.test(str)) {
    str = "'" + str;
  }
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

/**
 * Converts a result object into a multi-section CSV string.
 *
 * @param {object} result - The filtered result object from aggregation
 * @returns {string} The full CSV string with sections separated by blank lines
 */
export function toCSV(result) {
  const lines = [];

  for (const [sectionKey, sectionValue] of Object.entries(result)) {
    if (sectionValue === null || sectionValue === undefined) continue;

    if (
      sectionKey === 'summary' &&
      typeof sectionValue === 'object' &&
      !Array.isArray(sectionValue)
    ) {
      lines.push('# Summary');
      lines.push('key,value');
      for (const [k, v] of Object.entries(sectionValue)) {
        lines.push(`${csvField(k)},${csvField(v)}`);
      }
      lines.push('');
      continue;
    }

    if (sectionKey === 'contributors' && Array.isArray(sectionValue)) {
      lines.push('# Contributors');
      if (sectionValue.length > 0) {
        const headers = Object.keys(sectionValue[0]);
        lines.push(headers.map(csvField).join(','));
        for (const row of sectionValue) {
          lines.push(headers.map((h) => csvField(row[h])).join(','));
        }
      }
      lines.push('');
      continue;
    }

    if (sectionKey === 'frequency' && Array.isArray(sectionValue)) {
      lines.push('# Frequency');
      if (sectionValue.length > 0) {
        const headers = Object.keys(sectionValue[0]);
        lines.push(headers.map(csvField).join(','));
        for (const row of sectionValue) {
          lines.push(headers.map((h) => csvField(row[h])).join(','));
        }
      }
      lines.push('');
      continue;
    }

    if (sectionKey === 'languages' && Array.isArray(sectionValue)) {
      lines.push('# Languages');
      if (sectionValue.length > 0) {
        const headers = Object.keys(sectionValue[0]);
        lines.push(headers.map(csvField).join(','));
        for (const row of sectionValue) {
          lines.push(headers.map((h) => csvField(row[h])).join(','));
        }
      }
      lines.push('');
      continue;
    }

    if (sectionKey === 'contributions' && Array.isArray(sectionValue)) {
      lines.push('# Contributions');
      if (sectionValue.length > 0) {
        // Only emit top-level fields: date, count
        lines.push('date,count');
        for (const row of sectionValue) {
          lines.push(`${csvField(row.date)},${csvField(row.count)}`);
        }
      }
      lines.push('');
      continue;
    }

    if (
      sectionKey === 'activity' &&
      typeof sectionValue === 'object' &&
      !Array.isArray(sectionValue)
    ) {
      const activity = sectionValue;

      if (Array.isArray(activity.byDayOfWeek) && activity.byDayOfWeek.length > 0) {
        lines.push('# Activity by Day of Week');
        const headers = Object.keys(activity.byDayOfWeek[0]);
        lines.push(headers.map(csvField).join(','));
        for (const row of activity.byDayOfWeek) {
          lines.push(headers.map((h) => csvField(row[h])).join(','));
        }
        lines.push('');
      }

      if (Array.isArray(activity.byHour) && activity.byHour.length > 0) {
        lines.push('# Activity by Hour of Day');
        const headers = Object.keys(activity.byHour[0]);
        lines.push(headers.map(csvField).join(','));
        for (const row of activity.byHour) {
          lines.push(headers.map((h) => csvField(row[h])).join(','));
        }
        lines.push('');
      }

      if (Array.isArray(activity.topFiles) && activity.topFiles.length > 0) {
        lines.push('# Top Files');
        const headers = Object.keys(activity.topFiles[0]);
        lines.push(headers.map(csvField).join(','));
        for (const row of activity.topFiles) {
          lines.push(headers.map((h) => csvField(row[h])).join(','));
        }
        lines.push('');
      }
      continue;
    }
  }

  // Remove trailing blank line
  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }

  return lines.join('\n');
}

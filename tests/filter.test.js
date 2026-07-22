import { describe, it } from 'node:test';
import assert from 'node:assert';
import { downsampleData, computeFilteredSummary, sortContributors } from '../dashboard/filter.js';

describe('filter.js — downsampleData', () => {
  it('should return same array if length <= maxPoints', () => {
    const arr = [1, 2, 3];
    assert.strictEqual(downsampleData(arr, 10), arr);
  });

  it('should return same array when length equals maxPoints', () => {
    const arr = [1, 2, 3, 4, 5];
    assert.strictEqual(downsampleData(arr, 5), arr);
  });

  it('should downsample 100 items to 50, preserving first and last', () => {
    const arr = Array.from({ length: 100 }, function (_, i) {
      return i;
    });
    const result = downsampleData(arr, 50);
    assert.strictEqual(result.length, 50);
    assert.strictEqual(result[0], 0);
    assert.strictEqual(result[49], 99);
  });

  it('should downsample preserving first and last elements', () => {
    const arr = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    const result = downsampleData(arr, 4);
    assert.strictEqual(result.length, 4);
    assert.strictEqual(result[0], 10);
    assert.strictEqual(result[result.length - 1], 100);
  });

  it('should return empty array for empty input', () => {
    const arr = [];
    const result = downsampleData(arr, 10);
    assert.strictEqual(result, arr);
  });

  it('should return single-element array when maxPoints is 1', () => {
    const arr = [42, 99, 7];
    const result = downsampleData(arr, 1);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0], 42);
  });

  it('should not mutate the original array', () => {
    const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const copy = [...arr];
    downsampleData(arr, 3);
    assert.deepStrictEqual(arr, copy);
  });

  it('should handle undefined input', () => {
    assert.strictEqual(downsampleData(undefined, 10), undefined);
  });

  it('should handle null input', () => {
    assert.strictEqual(downsampleData(null, 10), null);
  });
});

describe('filter.js — computeFilteredSummary', () => {
  it('should return zeros with null dates for empty contributions', () => {
    const result = computeFilteredSummary([], []);
    assert.strictEqual(result.totalCommits, 0);
    assert.strictEqual(result.totalContributors, 0);
    assert.strictEqual(result.totalAdditions, 0);
    assert.strictEqual(result.totalDeletions, 0);
    assert.strictEqual(result.firstCommit, null);
    assert.strictEqual(result.lastCommit, null);
  });

  it('should compute correct totals for a single day', () => {
    const contributions = [
      {
        date: '2024-06-15',
        count: 5,
        authorDetails: [
          { author: 'Alice', email: 'a@t.com', count: 3 },
          { author: 'Bob', email: 'b@t.com', count: 2 }
        ]
      }
    ];
    const frequency = [{ date: '2024-06-15', additions: 100, deletions: 30 }];
    const result = computeFilteredSummary(contributions, frequency);
    assert.strictEqual(result.totalCommits, 5);
    assert.strictEqual(result.totalContributors, 2);
    assert.strictEqual(result.totalAdditions, 100);
    assert.strictEqual(result.totalDeletions, 30);
    assert.strictEqual(result.firstCommit, '2024-06-15');
    assert.strictEqual(result.lastCommit, '2024-06-15');
  });

  it('should sum across multiple days', () => {
    const contributions = [
      {
        date: '2024-01-01',
        count: 3,
        authorDetails: [{ author: 'Alice', email: 'a@t.com', count: 3 }]
      },
      {
        date: '2024-06-15',
        count: 7,
        authorDetails: [
          { author: 'Alice', email: 'a@t.com', count: 4 },
          { author: 'Bob', email: 'b@t.com', count: 3 }
        ]
      },
      {
        date: '2024-12-31',
        count: 2,
        authorDetails: [{ author: 'Bob', email: 'b@t.com', count: 2 }]
      }
    ];
    const frequency = [
      { date: '2024-01-01', additions: 30, deletions: 5 },
      { date: '2024-06-15', additions: 70, deletions: 20 },
      { date: '2024-12-31', additions: 15, deletions: 3 }
    ];
    const result = computeFilteredSummary(contributions, frequency);
    assert.strictEqual(result.totalCommits, 12);
    assert.strictEqual(result.totalContributors, 2);
    assert.strictEqual(result.totalAdditions, 115);
    assert.strictEqual(result.totalDeletions, 28);
    assert.strictEqual(result.firstCommit, '2024-01-01');
    assert.strictEqual(result.lastCommit, '2024-12-31');
  });

  it('should deduplicate contributors by email', () => {
    const contributions = [
      {
        date: '2024-06-15',
        count: 5,
        authorDetails: [
          { author: 'Alice', email: 'a@t.com', count: 3 },
          { author: 'Alice', email: 'a@t.com', count: 2 }
        ]
      }
    ];
    const result = computeFilteredSummary(contributions, []);
    assert.strictEqual(result.totalContributors, 1);
  });

  it('should fall back to author name when email is missing', () => {
    const contributions = [
      {
        date: '2024-06-15',
        count: 2,
        authorDetails: [{ author: 'Alice', count: 2 }]
      }
    ];
    const result = computeFilteredSummary(contributions, []);
    assert.strictEqual(result.totalContributors, 1);
  });

  it('should handle missing authorDetails gracefully', () => {
    const contributions = [{ date: '2024-06-15', count: 5 }];
    const result = computeFilteredSummary(contributions, []);
    assert.strictEqual(result.totalContributors, 0);
    assert.strictEqual(result.totalCommits, 5);
  });

  it('should handle contributions with no date field', () => {
    const contributions = [
      { count: 3, authorDetails: [{ author: 'A', email: 'a@t.com', count: 3 }] }
    ];
    const result = computeFilteredSummary(contributions, []);
    assert.strictEqual(result.totalCommits, 3);
    assert.strictEqual(result.totalContributors, 1);
    assert.strictEqual(result.firstCommit, null);
    assert.strictEqual(result.lastCommit, null);
  });

  it('should find correct earliest and latest dates', () => {
    const contributions = [
      {
        date: '2025-03-01',
        count: 1,
        authorDetails: [{ author: 'A', email: 'a@t.com', count: 1 }]
      },
      {
        date: '2024-01-01',
        count: 1,
        authorDetails: [{ author: 'A', email: 'a@t.com', count: 1 }]
      },
      { date: '2025-06-15', count: 1, authorDetails: [{ author: 'A', email: 'a@t.com', count: 1 }] }
    ];
    const result = computeFilteredSummary(contributions, []);
    assert.strictEqual(result.firstCommit, '2024-01-01');
    assert.strictEqual(result.lastCommit, '2025-06-15');
  });
});

describe('filter.js — sortContributors', () => {
  const contributors = [
    {
      name: 'Charlie',
      email: 'charlie@t.com',
      totalCommits: 5,
      additions: 200,
      deletions: 10,
      firstCommit: '2024-03-01',
      lastCommit: '2024-12-01'
    },
    {
      name: 'Alice',
      email: 'alice@t.com',
      totalCommits: 10,
      additions: 500,
      deletions: 20,
      firstCommit: '2024-01-01',
      lastCommit: '2024-11-01'
    },
    {
      name: 'Bob',
      email: 'bob@t.com',
      totalCommits: 7,
      additions: 300,
      deletions: 40,
      firstCommit: '2024-02-01',
      lastCommit: '2024-10-01'
    }
  ];

  it('should sort by commits descending by default', () => {
    const result = sortContributors(contributors, 'commits', 'desc');
    assert.strictEqual(result[0].name, 'Alice');
    assert.strictEqual(result[1].name, 'Bob');
    assert.strictEqual(result[2].name, 'Charlie');
  });

  it('should sort by commits ascending', () => {
    const result = sortContributors(contributors, 'commits', 'asc');
    assert.strictEqual(result[0].name, 'Charlie');
    assert.strictEqual(result[1].name, 'Bob');
    assert.strictEqual(result[2].name, 'Alice');
  });

  it('should sort by additions descending', () => {
    const result = sortContributors(contributors, 'additions', 'desc');
    assert.strictEqual(result[0].name, 'Alice');
    assert.strictEqual(result[1].name, 'Bob');
    assert.strictEqual(result[2].name, 'Charlie');
  });

  it('should sort by deletions descending', () => {
    const result = sortContributors(contributors, 'deletions', 'desc');
    assert.strictEqual(result[0].name, 'Bob');
    assert.strictEqual(result[1].name, 'Alice');
    assert.strictEqual(result[2].name, 'Charlie');
  });

  it('should sort by name ascending', () => {
    const result = sortContributors(contributors, 'name', 'asc');
    assert.strictEqual(result[0].name, 'Alice');
    assert.strictEqual(result[1].name, 'Bob');
    assert.strictEqual(result[2].name, 'Charlie');
  });

  it('should sort by firstCommit ascending', () => {
    const result = sortContributors(contributors, 'firstCommit', 'asc');
    assert.strictEqual(result[0].name, 'Alice');
    assert.strictEqual(result[1].name, 'Bob');
    assert.strictEqual(result[2].name, 'Charlie');
  });

  it('should sort by lastCommit ascending', () => {
    const result = sortContributors(contributors, 'lastCommit', 'asc');
    assert.strictEqual(result[0].name, 'Bob');
    assert.strictEqual(result[1].name, 'Alice');
    assert.strictEqual(result[2].name, 'Charlie');
  });

  it('should tie-break by name when sort values are equal', () => {
    const tied = [
      { name: 'Bob', email: 'b@t.com', totalCommits: 5 },
      { name: 'Alice', email: 'a@t.com', totalCommits: 5 }
    ];
    const resultAsc = sortContributors(tied, 'commits', 'asc');
    assert.strictEqual(resultAsc[0].name, 'Alice');
    assert.strictEqual(resultAsc[1].name, 'Bob');
  });

  it('should reverse name tie-break when sortOrder is descending', () => {
    const tied = [
      { name: 'Bob', email: 'b@t.com', totalCommits: 5 },
      { name: 'Alice', email: 'a@t.com', totalCommits: 5 }
    ];
    const resultDesc = sortContributors(tied, 'commits', 'desc');
    assert.strictEqual(resultDesc[0].name, 'Bob');
    assert.strictEqual(resultDesc[1].name, 'Alice');
  });

  it('should return a new array (not mutate input)', () => {
    const result = sortContributors(contributors, 'commits', 'desc');
    assert.notStrictEqual(result, contributors);
  });

  it('should return empty array for empty input', () => {
    const result = sortContributors([], 'commits', 'desc');
    assert.deepStrictEqual(result, []);
  });

  it('should return a copy for single contributor', () => {
    const single = [{ name: 'A', email: 'a@t.com', totalCommits: 1 }];
    const result = sortContributors(single, 'commits', 'desc');
    assert.deepStrictEqual(result, single);
    assert.notStrictEqual(result, single);
  });

  it('should handle contributors with missing sort fields gracefully', () => {
    const partial = [
      { name: 'Bob', email: 'b@t.com', totalCommits: 3 },
      { name: 'Alice', email: 'a@t.com' }
    ];
    const result = sortContributors(partial, 'commits', 'desc');
    assert.strictEqual(result[0].name, 'Bob');
    assert.strictEqual(result[1].name, 'Alice');
  });

  it('should not fall back to name tie-break when sortBy is name', () => {
    const sameName = [
      { name: 'Alice', email: 'a@t.com', totalCommits: 5 },
      { name: 'Alice', email: 'b@t.com', totalCommits: 3 }
    ];
    const result = sortContributors(sameName, 'name', 'asc');
    assert.strictEqual(result[0].email, 'a@t.com');
    assert.strictEqual(result[1].email, 'b@t.com');
  });
});

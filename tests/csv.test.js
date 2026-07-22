import { describe, it, before } from 'node:test';
import assert from 'node:assert';

/** @type {import('../src/csv.js').toCSV} */
let toCSV;

before(async () => {
  const mod = await import('../src/csv.js');
  toCSV = mod.toCSV;
});

describe('toCSV', () => {
  it('should handle empty result gracefully', () => {
    const csv = toCSV({});
    assert.strictEqual(csv, '');
  });

  it('should produce summary section as key-value pairs', () => {
    const result = {
      summary: {
        totalCommits: 42,
        totalContributors: 5,
        totalAdditions: 1000,
        totalDeletions: 500,
        firstCommit: '2024-01-01',
        lastCommit: '2024-12-31',
        activeBranches: 3,
        repoName: 'my-repo'
      }
    };
    const csv = toCSV(result);
    const lines = csv.split('\n');
    assert.strictEqual(lines[0], '# Summary');
    assert.strictEqual(lines[1], 'key,value');
    assert.ok(lines.some((l) => l === 'totalCommits,42'));
    assert.ok(lines.some((l) => l === 'totalContributors,5'));
    assert.ok(lines.some((l) => l === 'repoName,my-repo'));
  });

  it('should produce contributors section with headers from object keys', () => {
    const result = {
      contributors: [
        {
          name: 'Alice',
          email: 'alice@test.com',
          totalCommits: 10,
          additions: 100,
          deletions: 10,
          firstCommit: '2024-01-01',
          lastCommit: '2024-06-01'
        },
        {
          name: 'Bob',
          email: 'bob@test.com',
          totalCommits: 5,
          additions: 50,
          deletions: 5,
          firstCommit: '2024-02-01',
          lastCommit: '2024-05-01'
        }
      ]
    };
    const csv = toCSV(result);
    const lines = csv.split('\n');
    assert.strictEqual(lines[0], '# Contributors');
    assert.strictEqual(
      lines[1],
      'name,email,totalCommits,additions,deletions,firstCommit,lastCommit'
    );
    assert.ok(lines.some((l) => l.startsWith('Alice')));
    assert.ok(lines.some((l) => l.startsWith('Bob')));
    assert.ok(lines.some((l) => l.includes('alice@test.com')));
  });

  it('should produce frequency section', () => {
    const result = {
      frequency: [
        { date: '2024-01-01', additions: 100, deletions: 20 },
        { date: '2024-01-02', additions: 50, deletions: 10 }
      ]
    };
    const csv = toCSV(result);
    const lines = csv.split('\n');
    assert.strictEqual(lines[0], '# Frequency');
    assert.strictEqual(lines[1], 'date,additions,deletions');
    assert.ok(lines.some((l) => l === '2024-01-01,100,20'));
    assert.ok(lines.some((l) => l === '2024-01-02,50,10'));
  });

  it('should produce languages section', () => {
    const result = {
      languages: [
        { language: 'JavaScript', files: 10, linesChanged: 500 },
        { language: 'CSS', files: 5, linesChanged: 200 }
      ]
    };
    const csv = toCSV(result);
    const lines = csv.split('\n');
    assert.strictEqual(lines[0], '# Languages');
    assert.strictEqual(lines[1], 'language,files,linesChanged');
    assert.ok(lines.some((l) => l === 'JavaScript,10,500'));
    assert.ok(lines.some((l) => l === 'CSS,5,200'));
  });

  it('should produce contributions section with only date and count', () => {
    const result = {
      contributions: [
        { date: '2024-01-01', count: 3, byHour: [], topFiles: [], authorDetails: [] },
        { date: '2024-01-02', count: 1, byHour: [], topFiles: [], authorDetails: [] }
      ]
    };
    const csv = toCSV(result);
    const lines = csv.split('\n');
    assert.strictEqual(lines[0], '# Contributions');
    assert.strictEqual(lines[1], 'date,count');
    assert.ok(lines.some((l) => l === '2024-01-01,3'));
    assert.ok(lines.some((l) => l === '2024-01-02,1'));
  });

  it('should produce activity sub-sections', () => {
    const result = {
      activity: {
        byDayOfWeek: [
          { day: 'Mon', count: 10 },
          { day: 'Tue', count: 8 }
        ],
        byHour: [
          { hour: 9, count: 5 },
          { hour: 10, count: 3 }
        ],
        topFiles: [
          { path: 'src/index.js', changes: 15 },
          { path: 'src/utils.js', changes: 7 }
        ]
      }
    };
    const csv = toCSV(result);
    assert.ok(csv.includes('# Activity by Day of Week'));
    assert.ok(csv.includes('day,count'));
    assert.ok(csv.includes('Mon,10'));
    assert.ok(csv.includes('# Activity by Hour of Day'));
    assert.ok(csv.includes('hour,count'));
    assert.ok(csv.includes('9,5'));
    assert.ok(csv.includes('# Top Files'));
    assert.ok(csv.includes('path,changes'));
    assert.ok(csv.includes('src/index.js,15'));
  });

  it('should quote fields that contain commas', () => {
    const result = {
      contributors: [
        {
          name: 'Doe, John',
          email: 'john@test.com',
          totalCommits: 1,
          additions: 1,
          deletions: 0,
          firstCommit: '2024-01-01',
          lastCommit: '2024-01-01'
        }
      ]
    };
    const csv = toCSV(result);
    assert.ok(csv.includes('"Doe, John"'));
  });

  it('should quote fields that contain quotes', () => {
    const result = {
      contributors: [
        {
          name: 'Alice "The Great"',
          email: 'alice@test.com',
          totalCommits: 1,
          additions: 1,
          deletions: 0,
          firstCommit: '2024-01-01',
          lastCommit: '2024-01-01'
        }
      ]
    };
    const csv = toCSV(result);
    assert.ok(csv.includes('"Alice ""The Great"""'));
  });

  it('should handle empty arrays within sections', () => {
    const result = {
      contributors: [],
      activity: {
        byDayOfWeek: [],
        byHour: [],
        topFiles: []
      }
    };
    const csv = toCSV(result);
    assert.strictEqual(csv, '# Contributors');
  });

  it('should produce full multi-section output', () => {
    const result = {
      summary: {
        totalCommits: 1,
        totalContributors: 1,
        totalAdditions: 10,
        totalDeletions: 2,
        firstCommit: '2024-01-01',
        lastCommit: '2024-01-01',
        activeBranches: 1,
        repoName: 'test'
      },
      contributors: [
        {
          name: 'Test',
          email: 'test@test.com',
          totalCommits: 1,
          additions: 10,
          deletions: 2,
          firstCommit: '2024-01-01',
          lastCommit: '2024-01-01'
        }
      ],
      frequency: [{ date: '2024-01-01', additions: 10, deletions: 2 }],
      contributions: [{ date: '2024-01-01', count: 1 }],
      activity: {
        byDayOfWeek: [{ day: 'Mon', count: 1 }],
        byHour: [{ hour: 10, count: 1 }],
        topFiles: [{ path: 'file.txt', changes: 12 }]
      }
    };
    const csv = toCSV(result);

    assert.ok(csv.startsWith('# Summary'));
    assert.ok(csv.includes('# Contributors'));
    assert.ok(csv.includes('# Frequency'));
    assert.ok(csv.includes('# Contributions'));
    assert.ok(csv.includes('# Activity by Day of Week'));
    assert.ok(csv.includes('# Activity by Hour of Day'));
    assert.ok(csv.includes('# Top Files'));

    // Verify sections are separated (no consecutive header lines)
    const lines = csv.split('\n');
    const headerCount = lines.filter((l) => l.startsWith('#')).length;
    assert.strictEqual(headerCount, 7);
  });

  it('should sanitize formula-injection characters', () => {
    const result = {
      contributors: [
        {
          name: '=HYPERLINK("http://evil.com")',
          email: '+SUM(1,2)',
          totalCommits: 1,
          additions: 1,
          deletions: 0,
          firstCommit: '2024-01-01',
          lastCommit: '2024-01-01'
        }
      ]
    };
    const csv = toCSV(result);
    assert.ok(csv.includes("'=HYPERLINK"));
    assert.ok(csv.includes("'+SUM(1,2)"));
  });

  it('should use \\n line endings (no \\r\\n)', () => {
    const result = {
      summary: {
        totalCommits: 1,
        totalContributors: 1,
        totalAdditions: 0,
        totalDeletions: 0,
        firstCommit: '2024-01-01',
        lastCommit: '2024-01-01',
        activeBranches: 1,
        repoName: 'r'
      }
    };
    const csv = toCSV(result);
    assert.ok(!csv.includes('\r\n'), 'should not contain CRLF');
    assert.ok(csv.includes('\n'), 'should contain LF');
  });
});

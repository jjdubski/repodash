import http from 'node:http';
import { createReadStream, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import chalk from 'chalk';

// ---------------------------------------------------------------------------
// MIME types for static file serving
// ---------------------------------------------------------------------------
const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Stream a file to the HTTP response with the correct Content-Type header.
 * Responds with 404 if the file does not exist.
 *
 * @param {http.ServerResponse} res
 * @param {string} filePath - Absolute path to the requested file
 */
function serveFile(res, filePath) {
  if (!existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
    return;
  }
  const ext = extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': contentType,
    'Cache-Control': 'no-cache',
  });
  const stream = createReadStream(filePath);
  stream.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal Server Error');
    }
  });
  stream.pipe(res);
}

/**
 * Serve a static file from a base directory, verifying the resolved path stays
 * within that directory (path-traversal protection).
 *
 * @param {http.ServerResponse} res
 * @param {string} baseDir - Absolute path to the document-root directory
 * @param {string} urlPath - URL pathname (e.g. "/index.html" or "/data/summary.json")
 * @param {boolean} [dataRoute=false] - If true, only plain filenames are allowed
 *   (no sub-directories) — used for the /data/ route
 */
function serveStatic(res, baseDir, urlPath, dataRoute = false) {
  // Strip the leading slash so join() doesn't treat urlPath as absolute.
  // Guard against empty paths (e.g. "/data/" with nothing after).
  const relative = urlPath.startsWith('/') ? urlPath.slice(1) : urlPath;
  if (relative === '') {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Bad Request');
    return;
  }

  // Data-route files must be a plain basename — no directory components.
  if (dataRoute) {
    const basename = relative.replace(/^.*[/\\]/, '');
    // Also reject names that try to use dots for traversal
    if (basename !== relative || basename === '' || basename === '.' || basename === '..') {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Bad Request');
      return;
    }
  }

  const resolvedBase = resolve(baseDir);
  const resolvedPath = resolve(baseDir, relative);

  // Containment check: the resolved path must stay inside the base directory
  if (!resolvedPath.startsWith(resolvedBase + sep) && resolvedPath !== resolvedBase) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  serveFile(res, resolvedPath);
}

/**
 * Test whether a given port is available for binding.
 * Returns the actual port number (useful when `port` is 0 — the OS picks one).
 *
 * @param {number} port
 * @returns {Promise<number>}
 */
function findAvailablePort(port) {
  return new Promise((resolve, reject) => {
    const probe = http.createServer();
    probe.listen(port, () => {
      const assigned = probe.address().port;
      probe.close(() => resolve(assigned));
    });
    probe.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function createTempDir() {
  let tmpDir;
  try {
    tmpDir = mkdtempSync(join(tmpdir(), 'insights-'));
  } catch (err) {
    throw new Error(`Failed to create temp directory: ${err.message}`, { cause: err });
  }
  let dataDir;
  try {
    dataDir = join(tmpDir, 'data');
    mkdirSync(dataDir);
  } catch (err) {
    rmSync(tmpDir, { recursive: true, force: true });
    throw new Error(`Failed to create data directory: ${err.message}`, { cause: err });
  }
  return { tmpDir, dataDir };
}

const DATA_FILE_KEYS = ['summary', 'contributions', 'contributors', 'frequency', 'activity'];

async function writeDataFiles(dataDir, data) {
  try {
    const writes = DATA_FILE_KEYS.map((key) =>
      writeFile(join(dataDir, `${key}.json`), JSON.stringify(data[key] ?? {})),
    );
    writes.push(writeFile(join(dataDir, 'all.json'), JSON.stringify(data)));
    await Promise.all(writes);
  } catch (err) {
    throw new Error(`Failed to write data files: ${err.message}`, { cause: err });
  }
}

async function resolvePort(port) {
  if (port === 0) {
    return await findAvailablePort(0);
  }
  let current = port;
  let found = false;
  let actualPort;
  for (let attempt = 0; attempt <= 10 && !found; attempt++) {
    try {
      actualPort = await findAvailablePort(current);
      found = true;
    } catch (err) {
      if (err.code !== 'EADDRINUSE') throw err;
      current++;
    }
  }
  if (!found) {
    throw new Error(`Could not bind to any port from ${port} to ${port + 10}`);
  }
  return actualPort;
}

/**
 * Write aggregated data to a temp directory and start an HTTP server that
 * serves both the bundled dashboard UI and the generated JSON.
 *
 * The caller is responsible for browser opening and process signal handling.
 *
 * @param {object} data - Object returned by aggregate() with keys:
 *   summary, contributions, contributors, frequency, activity
 * @param {string} dashboardDir - Absolute path to the bundled dashboard/ directory
 * @param {number} [port=0] - Preferred port (0 = OS-assigned)
 * @returns {Promise<{port: number, tmpDir: string, server: http.Server}>}
 */
export async function serveDashboard(data, dashboardDir, port = 0) {
  const { tmpDir, dataDir } = createTempDir();

  try {
    await writeDataFiles(dataDir, data);
  } catch (err) {
    rmSync(tmpDir, { recursive: true, force: true });
    throw err;
  }

  // -----------------------------------------------------------------------
  // Dashboard dir warning (non-fatal — data API still works)
  // -----------------------------------------------------------------------
  if (!existsSync(dashboardDir)) {
    console.warn(chalk.yellow(`Dashboard directory not found: ${dashboardDir}`));
    console.warn(chalk.yellow('The server will serve data endpoints but the UI may not load.'));
  }

  let actualPort;
  try {
    actualPort = await resolvePort(port);
  } catch (err) {
    rmSync(tmpDir, { recursive: true, force: true });
    throw new Error(`Port error: ${err.message}`, { cause: err });
  }

  // -----------------------------------------------------------------------
  // 5. Start HTTP server
  // -----------------------------------------------------------------------
  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url, `http://localhost:${actualPort}`);
      let pathname = url.pathname;

      // Route root to index.html
      if (pathname === '/') pathname = '/index.html';

      if (pathname.startsWith('/data/')) {
        serveStatic(res, dataDir, pathname.replace('/data/', '/'), true);
      } else {
        serveStatic(res, dashboardDir, pathname);
      }
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Bad Request');
    }
  });

  await new Promise((resolve, reject) => {
    const onError = (err) => {
      rmSync(tmpDir, { recursive: true, force: true });
      reject(new Error(`Failed to start server: ${err.message}`));
    };
    server.once('error', onError);
    server.listen(actualPort, () => {
      server.off('error', onError);
      resolve();
    });
  });

  return { port: actualPort, tmpDir, server };
}

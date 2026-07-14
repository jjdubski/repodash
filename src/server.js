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
  '.map': 'application/json'
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
    'Cache-Control': 'no-cache'
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

// ── CSP header value ───────────────────────────────────────────────────────
const CSP_VALUE = [
  "default-src 'self'",
  "script-src 'self' https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data:",
  "connect-src 'self'"
].join('; ');

// ---------------------------------------------------------------------------
// Bind server directly (no TOCTOU race)
// ---------------------------------------------------------------------------

/**
 * Bind an http.Server to an available port.
 *
 * When `preferredPort` is 0 the OS assigns a port directly — no probe-close-
 * rebind cycle, so no race window. When a non-zero port is given, tries up to
 * 11 positions (port through port+10) if EADDRINUSE is encountered.
 *
 * @param {import('node:http').Server} server
 * @param {number} preferredPort
 * @returns {Promise<number>} The actual port the server is listening on
 */
function bindServer(server, preferredPort) {
  const maxPort = preferredPort + 10;

  if (preferredPort === 0) {
    return new Promise((resolve, reject) => {
      function onError(err) {
        server.removeListener('error', onError);
        reject(err);
      }
      server.on('error', onError);
      server.listen(0, () => {
        server.removeListener('error', onError);
        resolve(server.address().port);
      });
    });
  }

  let current = preferredPort;
  function tryBind() {
    return new Promise((resolve, reject) => {
      function onError(err) {
        server.removeListener('error', onError);
        if (err.code === 'EADDRINUSE' && current < maxPort) {
          current++;
          server.close(() => resolve(tryBind()));
        } else {
          reject(err);
        }
      }
      server.on('error', onError);
      server.listen(current, () => {
        server.removeListener('error', onError);
        resolve(server.address().port);
      });
    });
  }
  return tryBind();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function createTempDir() {
  let tmpDir;
  try {
    tmpDir = mkdtempSync(join(tmpdir(), 'repodash-'));
  } catch (err) {
    throw new Error(`failed to create temp directory: ${err.message}`, { cause: err });
  }
  let dataDir;
  try {
    dataDir = join(tmpDir, 'data');
    mkdirSync(dataDir);
  } catch (err) {
    rmSync(tmpDir, { recursive: true, force: true });
    throw new Error(`failed to create data directory: ${err.message}`, { cause: err });
  }
  return { tmpDir, dataDir };
}

const DATA_FILE_KEYS = ['summary', 'contributions', 'contributors', 'frequency'];

async function writeDataFiles(dataDir, data) {
  try {
    const writes = DATA_FILE_KEYS.map((key) =>
      writeFile(join(dataDir, `${key}.json`), JSON.stringify(data[key] ?? {}))
    );
    await Promise.all(writes);
  } catch (err) {
    throw new Error(`failed to write data files: ${err.message}`, { cause: err });
  }
}

/**
 * Write aggregated data to a temp directory and start an HTTP server that
 * serves both the bundled dashboard UI and the generated JSON.
 *
 * The caller is responsible for browser opening and process signal handling.
 *
 * @param {object} data - Object returned by aggregate() with keys:
 *   summary, contributions, contributors, frequency
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

  // -----------------------------------------------------------------------
  // 5. Create and bind HTTP server
  // -----------------------------------------------------------------------
  const server = http.createServer((req, res) => {
    // Set Content-Security-Policy on all responses
    res.setHeader('Content-Security-Policy', CSP_VALUE);

    try {
      const url = new URL(req.url, `http://localhost:${port}`);
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

  let actualPort;
  try {
    actualPort = await bindServer(server, port);
  } catch (err) {
    rmSync(tmpDir, { recursive: true, force: true });
    throw new Error(`port error: ${err.message}`, { cause: err });
  }

  return { port: actualPort, tmpDir, server };
}

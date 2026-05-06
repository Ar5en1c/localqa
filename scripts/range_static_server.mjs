#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 8765;
const DEFAULT_ROOT = '.';

const MIME_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.gguf', 'application/octet-stream'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.md', 'text/markdown; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.wasm', 'application/wasm'],
]);

function parseArgs(argv) {
  const options = {
    root: DEFAULT_ROOT,
    host: DEFAULT_HOST,
    port: DEFAULT_PORT,
    cors: true,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--root' && argv[i + 1]) {
      options.root = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--host' && argv[i + 1]) {
      options.host = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--port' && argv[i + 1]) {
      const parsed = Number.parseInt(argv[i + 1], 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        options.port = parsed;
      }
      i += 1;
      continue;
    }
    if (arg === '--no-cors') {
      options.cors = false;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
  }

  return options;
}

function printHelp() {
  console.log(`Range-capable local static server

Usage:
  node ./scripts/range_static_server.mjs [--root DIR] [--host HOST] [--port PORT]

Examples:
  node ./scripts/range_static_server.mjs --root .
  node ./scripts/range_static_server.mjs --root ./webllm-lab --port 8765
`);
}

function getContentType(filePath) {
  return MIME_TYPES.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream';
}

function parseByteRangeHeader(rangeHeader, size) {
  if (!rangeHeader || typeof rangeHeader !== 'string') {
    return null;
  }

  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
  if (!match) {
    return null;
  }

  const startRaw = match[1];
  const endRaw = match[2];

  if (!startRaw && !endRaw) {
    return null;
  }

  let start;
  let end;

  if (!startRaw) {
    const suffixLength = Number.parseInt(endRaw, 10);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
      return { error: 'invalid' };
    }
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number.parseInt(startRaw, 10);
    if (!Number.isFinite(start) || start < 0 || start >= size) {
      return { error: 'unsatisfiable' };
    }
    end = endRaw ? Number.parseInt(endRaw, 10) : size - 1;
    if (!Number.isFinite(end) || end < start) {
      return { error: 'invalid' };
    }
    end = Math.min(end, size - 1);
  }

  return {
    start,
    end,
    size: end - start + 1,
  };
}

function resolveRequestedPath(rootDir, requestPathname) {
  const safePath = decodeURIComponent(requestPathname || '/');
  const normalized = path.posix.normalize(safePath);
  const relativePath = normalized.replace(/^\/+/, '');
  const absPath = path.resolve(rootDir, relativePath);
  const relativeToRoot = path.relative(rootDir, absPath);
  if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
    return null;
  }
  return absPath;
}

function applyCommonHeaders(res, cors) {
  if (cors) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
    res.setHeader('Access-Control-Expose-Headers', 'Accept-Ranges, Content-Length, Content-Range, Content-Type');
  }
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Accept-Ranges', 'bytes');
}

function sendError(res, statusCode, message, cors) {
  applyCommonHeaders(res, cors);
  res.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(message),
  });
  res.end(message);
}

function maybeServeDirectoryIndex(filePath) {
  const indexPath = path.join(filePath, 'index.html');
  if (fs.existsSync(indexPath) && fs.statSync(indexPath).isFile()) {
    return indexPath;
  }
  return null;
}

function createStaticHandler(rootDir, options = {}) {
  const cors = options.cors !== false;

  return async function handleRequest(req, res) {
    try {
      if (!req.url) {
        sendError(res, 400, 'Missing request URL.', cors);
        return;
      }

      const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
      if (req.method === 'OPTIONS') {
        applyCommonHeaders(res, cors);
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendError(res, 405, `Method ${req.method} not allowed.`, cors);
        return;
      }

      let targetPath = resolveRequestedPath(rootDir, url.pathname);
      if (!targetPath) {
        sendError(res, 403, 'Forbidden path.', cors);
        return;
      }

      if (!fs.existsSync(targetPath)) {
        sendError(res, 404, 'Not found.', cors);
        return;
      }

      let stat = fs.statSync(targetPath);
      if (stat.isDirectory()) {
        const indexPath = maybeServeDirectoryIndex(targetPath);
        if (!indexPath) {
          sendError(res, 403, 'Directory listing is disabled.', cors);
          return;
        }
        targetPath = indexPath;
        stat = fs.statSync(targetPath);
      }

      const headers = {
        'Content-Type': getContentType(targetPath),
        'Last-Modified': stat.mtime.toUTCString(),
      };

      applyCommonHeaders(res, cors);

      const range = parseByteRangeHeader(req.headers.range, stat.size);
      if (range?.error === 'invalid') {
        sendError(res, 416, 'Invalid Range header.', cors);
        return;
      }
      if (range?.error === 'unsatisfiable') {
        res.setHeader('Content-Range', `bytes */${stat.size}`);
        sendError(res, 416, 'Range not satisfiable.', cors);
        return;
      }

      if (range) {
        headers['Content-Range'] = `bytes ${range.start}-${range.end}/${stat.size}`;
        headers['Content-Length'] = String(range.size);
        res.writeHead(206, headers);
        if (req.method === 'HEAD') {
          res.end();
          return;
        }
        fs.createReadStream(targetPath, {
          start: range.start,
          end: range.end,
        }).pipe(res);
        return;
      }

      headers['Content-Length'] = String(stat.size);
      res.writeHead(200, headers);
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      fs.createReadStream(targetPath).pipe(res);
    } catch (err) {
      sendError(res, 500, err?.message || 'Internal server error.', cors);
    }
  };
}

function startStaticServer(options = {}) {
  const rootDir = path.resolve(options.root || DEFAULT_ROOT);
  const port = options.port || DEFAULT_PORT;
  const host = options.host || DEFAULT_HOST;
  const cors = options.cors !== false;
  const handler = createStaticHandler(rootDir, { cors });
  const server = http.createServer(handler);
  server.listen(port, host, () => {
    console.log(`Serving ${rootDir} at http://${host}:${port}`);
  });
  return server;
}

const thisFile = fileURLToPath(import.meta.url);
const entryFile = process.argv[1] ? path.resolve(process.argv[1]) : null;

if (entryFile && thisFile === entryFile) {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    process.exit(0);
  }
  startStaticServer(options);
}

export {
  createStaticHandler,
  getContentType,
  parseArgs,
  parseByteRangeHeader,
  resolveRequestedPath,
  startStaticServer,
};

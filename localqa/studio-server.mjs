#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runUiQa, summarizeForMcp } from './core/qa-core.mjs';
import { runSiteQa } from './core/site-core.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const STUDIO_DIR = path.join(__dirname, 'studio');
const REPORTS_DIR = path.join(ROOT, 'reports', 'localqa');
const PORT = Number.parseInt(process.env.LOCALQA_STUDIO_PORT || '6197', 10);
const DEFAULT_BALANCED_MODEL = 'qwen2.5-coder:3b';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

function json(res, status, body) {
  const text = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(text);
}

function text(res, status, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'content-type': contentType,
    'cache-control': 'no-store',
  });
  res.end(body);
}

function sanitizeSlug(value) {
  return String(value || '')
    .replace(/^https?:\/\//, '')
    .replace(/[^a-z0-9_.-]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'run';
}

function bool(value, fallback = false) {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return fallback;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    return value.split('\n').map((line) => line.trim()).filter(Boolean);
  }
  return [];
}

function absInside(base, target) {
  const resolved = path.resolve(target);
  const rel = path.relative(base, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Path escapes allowed root: ${target}`);
  }
  return resolved;
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function listReportFiles(dir = REPORTS_DIR, depth = 0) {
  if (depth > 4 || !(await pathExists(dir))) return [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listReportFiles(full, depth + 1));
      continue;
    }
    if (entry.isFile() && ['report.json', 'site-report.json'].includes(entry.name)) {
      const stat = await fs.stat(full);
      files.push({
        path: full,
        relativePath: path.relative(ROOT, full),
        name: path.basename(path.dirname(full)),
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
      });
    }
  }
  return files;
}

async function findScreenshots(outputDir) {
  const screenshotsDir = path.join(outputDir, 'screenshots');
  if (!(await pathExists(screenshotsDir))) return [];
  const entries = await fs.readdir(screenshotsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /\.(png|jpe?g)$/i.test(entry.name))
    .map((entry) => path.join(screenshotsDir, entry.name));
}

async function imageToBase64(filePath) {
  const data = await fs.readFile(filePath);
  return data.toString('base64');
}

async function callOllamaReview({ mode, model, report, outputDir, timeoutMs = 120000 }) {
  if (!model || mode === 'fast') return null;

  const screenshotPaths = mode === 'vision' || mode === 'vision_thinking'
    ? await findScreenshots(outputDir)
    : [];
  const images = [];
  for (const screenshotPath of screenshotPaths.slice(0, 4)) {
    images.push(await imageToBase64(screenshotPath));
  }

  const system = [
    'You are LocalQA, a strict software QA reviewer and senior web code reviewer.',
    'Return concise raw JSON only. Do not wrap the response in markdown fences.',
    'Use short strings in arrays. Do not copy raw evidence objects, rectangles, stack traces, or full request records.',
    'Keep the full response under 180 words.',
    'Focus on actionable launch-blocking issues, false-positive risk, and the next fix.',
    'Separate confirmed failures from unproven signals.',
    'Do not claim a user journey is broken unless explicit evidence shows the action or expected transition failed.',
    'Treat isolated HTTP 4xx responses as unprovenSignals until payload, test fixture, and expected validation are known.',
    'Do not put isolated HTTP 4xx responses in confirmedIssues.',
    'Do not invent filenames; use likely code areas when source paths are unknown.',
  ].join(' ');

  const prompt = [
    `Review mode: ${mode}`,
    'Evidence summary:',
    JSON.stringify(summarizeForMcp(report), null, 2),
    '',
    'Return JSON with keys: summary, severity, topIssues, likelyFixes, falsePositiveRisks.',
  ].join('\n');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch('http://127.0.0.1:11434/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        stream: false,
        think: mode === 'code_thinking' || mode === 'vision_thinking',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt, ...(images.length ? { images } : {}) },
        ],
        options: {
          temperature: 0,
          num_predict: 384,
        },
      }),
    });
    const json = await response.json();
    const content = json?.message?.content || json?.response || '';
    return {
      ok: response.ok,
      mode,
      model,
      status: response.status,
      screenshotCount: images.length,
      content,
      stats: {
        totalDurationNs: json?.total_duration,
        loadDurationNs: json?.load_duration,
        promptEvalCount: json?.prompt_eval_count,
        evalCount: json?.eval_count,
      },
    };
  } catch (err) {
    return {
      ok: false,
      mode,
      model,
      error: err?.name === 'AbortError' ? `Ollama review timed out after ${timeoutMs}ms` : err?.message || String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function handleRun(body) {
  const url = String(body.url || '').trim();
  if (!url) throw new Error('URL is required');
  new URL(url);

  const runKind = body.runKind === 'site' ? 'site' : 'page';
  const reviewMode = body.reviewMode || 'fast';
  const slug = sanitizeSlug(url);
  const stamp = new Date().toISOString().replace(/[:.]/g, '').replace('T', '_').slice(0, 17);
  const outputDir = path.join(REPORTS_DIR, `studio_${runKind}_${slug}_${stamp}`);
  const expectedText = asArray(body.expectedText);
  const screenshot = bool(body.screenshot, reviewMode === 'vision' || reviewMode === 'vision_thinking');
  const common = {
    goal: body.goal || `Review ${url} for launch-readiness issues.`,
    outputDir,
    waitMs: Number.parseInt(body.waitMs, 10) || 750,
    expectedText,
    screenshot,
    headless: true,
  };

  const report = runKind === 'site'
    ? await runSiteQa({
        url,
        ...common,
        maxLinks: Number.parseInt(body.maxLinks, 10) || 5,
        sameOrigin: body.sameOrigin !== false,
      })
    : await runUiQa({
        url,
        ...common,
      });

  const modelReview = await callOllamaReview({
    mode: reviewMode,
    model: body.ollamaModel || (reviewMode === 'fast' ? '' : DEFAULT_BALANCED_MODEL),
    report,
    outputDir,
    timeoutMs: Number.parseInt(body.ollamaTimeoutMs, 10) || 120000,
  });

  const response = {
    ok: report.findingCount === 0,
    runKind,
    reviewMode,
    report: runKind === 'site' ? report : summarizeForMcp(report),
    modelReview,
  };

  await fs.writeFile(path.join(outputDir, 'studio-response.json'), JSON.stringify(response, null, 2));
  return response;
}

async function handleStatic(req, res, pathname) {
  const target = pathname === '/' ? path.join(STUDIO_DIR, 'index.html') : path.join(STUDIO_DIR, pathname);
  const filePath = absInside(STUDIO_DIR, target);
  const ext = path.extname(filePath).toLowerCase();
  const data = await fs.readFile(filePath);
  res.writeHead(200, {
    'content-type': MIME[ext] || 'application/octet-stream',
    'cache-control': 'no-store',
  });
  res.end(data);
}

async function handleRequest(req, res) {
  const parsed = new URL(req.url, `http://${req.headers.host || `127.0.0.1:${PORT}`}`);
  const pathname = parsed.pathname;

  try {
    if (req.method === 'GET' && pathname === '/api/health') {
      const health = {
        ok: true,
        reportsDir: REPORTS_DIR,
        playwright: { ok: false },
        ollama: { ok: false },
      };
      try {
        await import('playwright');
        health.playwright = { ok: true };
      } catch (err) {
        health.ok = false;
        health.playwright = { ok: false, error: err?.message || String(err) };
      }
      try {
        const response = await fetch('http://127.0.0.1:11434/api/tags');
        const data = await response.json();
        health.ollama = {
          ok: response.ok,
          models: Array.isArray(data.models) ? data.models.map((item) => item.name) : [],
        };
      } catch (err) {
        health.ollama = { ok: false, error: err?.message || String(err) };
      }
      json(res, 200, health);
      return;
    }

    if (req.method === 'GET' && pathname === '/api/reports') {
      const reports = (await listReportFiles()).sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
      json(res, 200, { reports: reports.slice(0, 80) });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/report') {
      const reportPath = parsed.searchParams.get('path') || '';
      const full = absInside(REPORTS_DIR, path.isAbsolute(reportPath) ? reportPath : path.join(ROOT, reportPath));
      const raw = await fs.readFile(full, 'utf8');
      json(res, 200, JSON.parse(raw));
      return;
    }

    if (req.method === 'GET' && pathname === '/artifact') {
      const artifactPath = parsed.searchParams.get('path') || '';
      const full = absInside(REPORTS_DIR, path.isAbsolute(artifactPath) ? artifactPath : path.join(ROOT, artifactPath));
      const ext = path.extname(full).toLowerCase();
      const data = await fs.readFile(full);
      res.writeHead(200, {
        'content-type': MIME[ext] || 'application/octet-stream',
        'cache-control': 'no-store',
      });
      res.end(data);
      return;
    }

    if (req.method === 'POST' && pathname === '/api/run') {
      const body = await readJsonBody(req);
      json(res, 200, await handleRun(body));
      return;
    }

    if (req.method === 'GET') {
      await handleStatic(req, res, pathname);
      return;
    }

    text(res, 405, 'Method not allowed');
  } catch (err) {
    json(res, 500, {
      ok: false,
      error: err?.message || String(err),
    });
  }
}

await fs.mkdir(REPORTS_DIR, { recursive: true });

const server = http.createServer((req, res) => {
  handleRequest(req, res);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`LocalQA Studio running at http://127.0.0.1:${PORT}`);
});

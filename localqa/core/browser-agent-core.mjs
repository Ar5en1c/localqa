import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_VIEWPORT = { name: 'desktop', width: 1440, height: 900 };
const DEFAULT_REPORTS_DIR = path.resolve('reports/localqa/browser-agent');
const sessions = new Map();

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix = 'browser') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function trimText(value, max = 1000) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function approxTokens(value) {
  return Math.ceil(String(value || '').length / 4);
}

function normalizeViewport(viewport = DEFAULT_VIEWPORT) {
  return {
    name: viewport.name || 'desktop',
    width: Number.parseInt(viewport.width, 10) || DEFAULT_VIEWPORT.width,
    height: Number.parseInt(viewport.height, 10) || DEFAULT_VIEWPORT.height,
  };
}

function assertHttpUrl(value, label = 'url') {
  const parsed = new URL(value);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`${label} must be http(s)`);
  }
  return parsed;
}

function isLocalUrl(value) {
  try {
    const parsed = new URL(value);
    return ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
  } catch {
    return false;
  }
}

async function ensureDir(dir) {
  const requested = path.resolve(dir);
  try {
    await fs.mkdir(requested, { recursive: true });
    return { dir: requested, fallback: null };
  } catch (err) {
    if (!['EACCES', 'EPERM'].includes(err?.code)) throw err;
    const fallback = path.join(os.tmpdir(), 'localqa-browser-agent', path.basename(requested) || 'reports');
    await fs.mkdir(fallback, { recursive: true });
    return {
      dir: fallback,
      fallback: {
        requested,
        actual: fallback,
        reason: err?.code || 'permission_error',
      },
    };
  }
}

async function importChromium() {
  const { chromium } = await import('playwright');
  return chromium;
}

function attachEventCollectors(page, state) {
  page.on('console', (message) => {
    state.console.push({
      type: message.type(),
      text: trimText(message.text(), 600),
      location: message.location(),
      at: nowIso(),
    });
  });
  page.on('pageerror', (error) => {
    state.pageErrors.push({
      message: trimText(error?.message || String(error), 1000),
      stack: trimText(error?.stack || '', 2000),
      at: nowIso(),
    });
  });
  page.on('requestfailed', (request) => {
    state.failedRequests.push({
      url: request.url(),
      method: request.method(),
      failure: request.failure()?.errorText || 'request failed',
      at: nowIso(),
    });
  });
  page.on('response', (response) => {
    const status = response.status();
    if (status >= 400) {
      state.badResponses.push({
        url: response.url(),
        status,
        statusText: response.statusText(),
        at: nowIso(),
      });
    }
  });
}

async function extractDom(page, options = {}) {
  const maxTextChars = Number.parseInt(options.maxTextChars, 10) || 6000;
  const maxLinks = Number.parseInt(options.maxLinks, 10) || 40;
  return page.evaluate(({ maxTextChars, maxLinks }) => {
    function text(el) {
      return (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
    }
    function cssPath(el) {
      if (!el || !el.tagName) return '';
      const tag = el.tagName.toLowerCase();
      if (el.id) return `${tag}#${CSS.escape(el.id)}`;
      const cls = Array.from(el.classList || []).slice(0, 2).map((item) => `.${CSS.escape(item)}`).join('');
      const name = el.getAttribute?.('name');
      if (name) return `${tag}[name="${CSS.escape(name)}"]`;
      return `${tag}${cls}`;
    }
    const headings = Array.from(document.querySelectorAll('h1,h2,h3')).slice(0, 30).map((el) => ({
      level: el.tagName.toLowerCase(),
      text: text(el).slice(0, 220),
    }));
    const links = Array.from(document.querySelectorAll('a[href]')).slice(0, maxLinks).map((el) => ({
      text: text(el).slice(0, 180),
      href: el.href,
      selector: cssPath(el),
    }));
    const controls = Array.from(document.querySelectorAll('button,input,textarea,select,[role="button"]')).slice(0, 60).map((el) => ({
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type') || '',
      role: el.getAttribute('role') || '',
      text: text(el).slice(0, 120),
      ariaLabel: el.getAttribute('aria-label') || '',
      placeholder: el.getAttribute('placeholder') || '',
      selector: cssPath(el),
    }));
    const forms = Array.from(document.querySelectorAll('form')).slice(0, 20).map((el) => ({
      selector: cssPath(el),
      text: text(el).slice(0, 500),
      action: el.action || '',
      method: el.method || '',
    }));
    const bodyText = text(document.body).slice(0, maxTextChars);
    return {
      title: document.title,
      url: location.href,
      bodyText,
      headings,
      links,
      controls,
      forms,
      scroll: {
        innerWidth,
        innerHeight,
        bodyScrollWidth: document.body?.scrollWidth || 0,
        documentScrollWidth: document.documentElement?.scrollWidth || 0,
        hasHorizontalOverflow: Math.max(document.body?.scrollWidth || 0, document.documentElement?.scrollWidth || 0) > innerWidth + 2,
      },
    };
  }, { maxTextChars, maxLinks });
}

async function buildSnapshot(session, options = {}) {
  const page = session.page;
  const dom = await extractDom(page, options);
  let screenshotPath = null;
  if (options.screenshot) {
    const outputDirResult = await ensureDir(options.outputDir || session.outputDir || DEFAULT_REPORTS_DIR);
    const dir = outputDirResult.dir;
    session.snapshotCount += 1;
    screenshotPath = path.resolve(dir, `${session.id}-snapshot-${String(session.snapshotCount).padStart(3, '0')}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
  }
  const snapshot = {
    sessionId: session.id,
    generatedAt: nowIso(),
    url: page.url(),
    title: await page.title().catch(() => dom.title),
    dom,
    screenshotPath,
    events: {
      console: session.console.slice(-50),
      pageErrors: session.pageErrors.slice(-20),
      failedRequests: session.failedRequests.slice(-30),
      badResponses: session.badResponses.slice(-30),
    },
    tokenEstimate: {
      compactApproxTokens: Math.ceil(JSON.stringify({
        url: page.url(),
        title: dom.title,
        headings: dom.headings,
        controls: dom.controls,
        events: {
          console: session.console.slice(-10),
          badResponses: session.badResponses.slice(-10),
        },
      }).length / 4),
    },
  };
  session.lastSnapshot = snapshot;
  return snapshot;
}

function getSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) throw new Error(`Unknown browser session: ${sessionId}`);
  return session;
}

export async function browserStartSession(options = {}) {
  const url = String(options.url || '').trim();
  if (url) assertHttpUrl(url);
  const viewport = normalizeViewport(options.viewport);
  const outputDirResult = await ensureDir(options.outputDir || DEFAULT_REPORTS_DIR);
  const outputDir = outputDirResult.dir;
  const chromium = await importChromium();
  const browser = await chromium.launch({ headless: options.headless !== false });
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const session = {
    id: createId('browser'),
    createdAt: nowIso(),
    outputDir,
    viewport,
    browser,
    context,
    page,
    console: [],
    pageErrors: [],
    failedRequests: [],
    badResponses: [],
    snapshotCount: 0,
    lastSnapshot: null,
    outputDirFallback: outputDirResult.fallback,
  };
  attachEventCollectors(page, session);
  sessions.set(session.id, session);
  if (url) {
    await page.goto(url, { waitUntil: options.waitUntil || 'networkidle', timeout: options.timeoutMs || 45000 });
    if (options.waitMs > 0) await page.waitForTimeout(options.waitMs);
  }
  const snapshot = await buildSnapshot(session, {
    screenshot: options.screenshot === true,
    outputDir,
    maxTextChars: options.maxTextChars,
    maxLinks: options.maxLinks,
  });
  return {
    ok: true,
    sessionId: session.id,
    viewport,
    snapshot,
    safety: {
      default: 'Read-only/safe-by-default. Non-local risky clicks require allowUnsafe=true.',
    },
    outputDirFallback: outputDirResult.fallback,
  };
}

async function assertSafeAction(session, action, allowUnsafe) {
  if (allowUnsafe || isLocalUrl(session.page.url())) return;
  if (!['click', 'check', 'uncheck', 'press'].includes(action.type)) return;
  const selector = action.selector;
  if (!selector) return;
  const risk = await session.page.$eval(selector, (el) => {
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    const role = (el.getAttribute('role') || '').toLowerCase();
    const text = (el.innerText || el.textContent || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const riskyText = /(submit|send|buy|purchase|pay|delete|remove|apply|confirm|book|reserve|checkout)/.test(text);
    return {
      tag,
      type,
      role,
      text: text.slice(0, 120),
      risky: tag === 'button' || type === 'submit' || role === 'button' || riskyText,
    };
  }).catch(() => ({ risky: false }));
  if (risk.risky) {
    throw new Error(`Blocked potentially mutating action on non-local page. Pass allowUnsafe=true only with explicit user approval. Element: ${JSON.stringify(risk)}`);
  }
}

export async function browserAct(options = {}) {
  const session = getSession(options.sessionId);
  const action = options.action || {};
  const type = action.type || options.type;
  const selector = action.selector || options.selector;
  const value = action.value ?? options.value;
  const text = action.text ?? options.text;
  const key = action.key ?? options.key;
  const timeoutMs = action.timeoutMs || options.timeoutMs || 5000;
  const waitAfterMs = action.waitAfterMs ?? options.waitAfterMs ?? 250;

  await assertSafeAction(session, { type, selector }, options.allowUnsafe === true);

  const page = session.page;
  const result = { type, selector, value: value == null ? undefined : String(value).slice(0, 200), ok: true };
  if (type === 'goto') {
    assertHttpUrl(value, 'goto value');
    await page.goto(value, { waitUntil: 'networkidle', timeout: timeoutMs });
  } else if (type === 'click') {
    await page.click(selector, { timeout: timeoutMs });
  } else if (type === 'fill') {
    await page.fill(selector, String(value ?? ''), { timeout: timeoutMs });
  } else if (type === 'press') {
    await page.press(selector, key || String(value || 'Enter'), { timeout: timeoutMs });
  } else if (type === 'select') {
    await page.selectOption(selector, String(value ?? ''), { timeout: timeoutMs });
  } else if (type === 'check') {
    await page.check(selector, { timeout: timeoutMs });
  } else if (type === 'uncheck') {
    await page.uncheck(selector, { timeout: timeoutMs });
  } else if (type === 'wait') {
    await page.waitForTimeout(Number.parseInt(value, 10) || waitAfterMs || 500);
  } else if (type === 'wait_for_text') {
    await page.getByText(text || String(value || ''), { exact: false }).waitFor({ timeout: timeoutMs });
  } else if (type === 'assert_text') {
    const body = await page.locator('body').innerText({ timeout: timeoutMs });
    if (!body.includes(text || String(value || ''))) throw new Error(`Text not found: ${text || value}`);
  } else {
    throw new Error(`Unsupported browser action: ${type}`);
  }
  if (waitAfterMs > 0) await page.waitForTimeout(waitAfterMs);
  const snapshot = await buildSnapshot(session, {
    screenshot: options.screenshot === true,
    outputDir: options.outputDir,
    maxTextChars: options.maxTextChars,
    maxLinks: options.maxLinks,
  });
  return { ok: true, action: result, snapshot };
}

export async function browserSnapshot(options = {}) {
  const session = getSession(options.sessionId);
  return buildSnapshot(session, options);
}

export async function browserEndSession(options = {}) {
  const session = getSession(options.sessionId);
  sessions.delete(session.id);
  await session.context.close().catch(() => null);
  await session.browser.close().catch(() => null);
  return {
    ok: true,
    sessionId: session.id,
    closedAt: nowIso(),
    lastSnapshot: session.lastSnapshot,
  };
}

export function listBrowserSessions() {
  return Array.from(sessions.values()).map((session) => ({
    sessionId: session.id,
    createdAt: session.createdAt,
    url: session.page.url(),
    viewport: session.viewport,
    outputDir: session.outputDir,
  }));
}

export async function browserExtractPage(options = {}) {
  const url = String(options.url || '').trim();
  assertHttpUrl(url);
  const session = await browserStartSession({
    url,
    headless: true,
    waitMs: options.waitMs ?? 750,
    screenshot: options.screenshot === true,
    outputDir: options.outputDir,
    viewport: options.viewport || DEFAULT_VIEWPORT,
    maxTextChars: options.maxTextChars || 10000,
    maxLinks: options.maxLinks || 80,
  });
  const snapshot = session.snapshot;
  await browserEndSession({ sessionId: session.sessionId });
  const compactPayload = {
    url,
    finalUrl: snapshot.url,
    title: snapshot.title,
    headings: snapshot.dom.headings,
    links: snapshot.dom.links,
    controls: snapshot.dom.controls,
    events: snapshot.events,
    text: trimText(snapshot.dom.bodyText, options.maxTextChars || 10000),
  };
  const rawEvidenceApproxTokens = approxTokens(JSON.stringify(snapshot));
  const compactReportApproxTokens = approxTokens(JSON.stringify(compactPayload));
  return {
    ok: true,
    ...compactPayload,
    extractedAt: nowIso(),
    screenshotPath: snapshot.screenshotPath,
    tokenEstimate: snapshot.tokenEstimate,
    outputDirFallback: session.outputDirFallback || null,
    tokenSavings: {
      rawEvidenceApproxTokens,
      compactReportApproxTokens,
      savedApproxTokens: Math.max(0, rawEvidenceApproxTokens - compactReportApproxTokens),
      reductionRatio: rawEvidenceApproxTokens > 0
        ? Math.max(0, +((1 - compactReportApproxTokens / rawEvidenceApproxTokens) * 100).toFixed(2))
        : 0,
    },
  };
}

export async function browserSearch(options = {}) {
  const query = trimText(options.query, 300);
  if (!query) throw new Error('browserSearch requires query');
  const maxResults = Number.parseInt(options.maxResults, 10) || 8;
  const searchUrl = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const extracted = await browserExtractPage({
    url: searchUrl,
    waitMs: options.waitMs ?? 1000,
    maxTextChars: 12000,
    maxLinks: 120,
  });
  const results = [];
  const seen = new Set();
  for (const link of extracted.links || []) {
    try {
      const parsed = new URL(link.href);
      if (!['http:', 'https:'].includes(parsed.protocol)) continue;
      if (/duckduckgo\.com$/.test(parsed.hostname)) continue;
      const key = parsed.toString();
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({
        title: trimText(link.text, 180) || parsed.hostname,
        url: key,
      });
      if (results.length >= maxResults) break;
    } catch {
      // Ignore malformed links.
    }
  }
  return {
    ok: true,
    query,
    source: searchUrl,
    results,
    note: results.length ? 'Search results extracted from DuckDuckGo HTML.' : 'No usable external results extracted.',
  };
}

function scoreSnippet(text, terms) {
  const lower = text.toLowerCase();
  return terms.reduce((sum, term) => sum + (lower.includes(term) ? 1 : 0), 0);
}

function extractSnippets(text, query, maxSnippets = 5) {
  const terms = query.toLowerCase().split(/\W+/).filter((term) => term.length > 2).slice(0, 12);
  const chunks = String(text || '')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((item) => trimText(item, 500))
    .filter((item) => item.length > 40);
  return chunks
    .map((item) => ({ text: item, score: scoreSnippet(item, terms) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxSnippets)
    .map((item) => item.text);
}

export async function browserResearchTask(options = {}) {
  const query = trimText(options.query, 500);
  if (!query) throw new Error('browserResearchTask requires query');
  const maxSources = Number.parseInt(options.maxSources, 10) || 4;
  let urls = Array.isArray(options.urls) ? options.urls.filter(Boolean).slice(0, maxSources) : [];
  let search = null;
  if (urls.length === 0) {
    search = await browserSearch({ query, maxResults: maxSources });
    urls = (search.results || []).map((item) => item.url).slice(0, maxSources);
  }
  const sources = [];
  let rawEvidenceApproxTokens = 0;
  for (const url of urls) {
    try {
      const page = await browserExtractPage({
        url,
        waitMs: options.waitMs ?? 1000,
        maxTextChars: options.maxTextChars || 12000,
        maxLinks: 30,
      });
      rawEvidenceApproxTokens += approxTokens(JSON.stringify({
        url: page.finalUrl,
        title: page.title,
        text: page.text,
        headings: page.headings,
        links: page.links,
        controls: page.controls,
        events: page.events,
      }));
      sources.push({
        url: page.finalUrl,
        title: page.title,
        headings: page.headings?.slice(0, 8) || [],
        snippets: extractSnippets(page.text, query, options.maxSnippets || 5),
        tokenEstimate: page.tokenEstimate,
      });
    } catch (err) {
      sources.push({
        url,
        error: err?.message || String(err),
      });
    }
  }
  const answer = sources
    .filter((source) => !source.error)
    .flatMap((source) => source.snippets.map((snippet) => `- ${snippet} [${source.title || source.url}]`))
    .slice(0, 10);
  const compactPayload = {
    query,
    mode: 'extractive_research',
    search,
    sources,
    answerBullets: answer,
  };
  const compactReportApproxTokens = approxTokens(JSON.stringify(compactPayload));
  return {
    ok: true,
    ...compactPayload,
    limitations: [
      'This is extractive research, not a final expert answer.',
      'The main LLM should use the cited source snippets for final synthesis.',
    ],
    tokenEstimate: {
      compactApproxTokens: Math.ceil(JSON.stringify({ query, sources }).length / 4),
    },
    tokenSavings: {
      rawEvidenceApproxTokens,
      compactReportApproxTokens,
      savedApproxTokens: Math.max(0, rawEvidenceApproxTokens - compactReportApproxTokens),
      reductionRatio: rawEvidenceApproxTokens > 0
        ? Math.max(0, +((1 - compactReportApproxTokens / rawEvidenceApproxTokens) * 100).toFixed(2))
        : 0,
    },
  };
}

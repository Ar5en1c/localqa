import fs from 'node:fs/promises';
import path from 'node:path';
import { runUiQa, summarizeForMcp } from './qa-core.mjs';

function trimText(value, max = 180) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function safeDirName(value, fallback = 'route') {
  return String(value || fallback)
    .replace(/^https?:\/\//, '')
    .replace(/[^a-z0-9_.-]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120) || fallback;
}

function normalizeUrl(value) {
  const parsed = new URL(value);
  parsed.hash = '';
  if (parsed.pathname !== '/' && parsed.pathname.endsWith('/')) {
    parsed.pathname = parsed.pathname.slice(0, -1);
  }
  return parsed.toString();
}

function addUniqueLink(out, seen, item) {
  try {
    const normalized = normalizeUrl(item.href);
    if (seen.has(normalized)) return;
    seen.add(normalized);
    out.push({
      url: normalized,
      text: trimText(item.text, 120),
      selector: trimText(item.selector, 120),
    });
  } catch {
    // Ignore non-URL hrefs.
  }
}

export async function discoverSiteLinks(options = {}) {
  const startedAt = performance.now();
  const {
    url,
    maxLinks = 12,
    sameOrigin = true,
    waitMs = 750,
    headless = true,
  } = options;

  if (!url) throw new Error('discoverSiteLinks requires url');

  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const start = new URL(url);
  const links = [];
  const seen = new Set();

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
    if (waitMs > 0) await page.waitForTimeout(waitMs);
    addUniqueLink(links, seen, { href: page.url(), text: 'current page', selector: 'document' });

    const pageLinks = await page.evaluate(() => {
      function cssPath(el) {
        if (!el || !el.tagName) return '';
        const tag = el.tagName.toLowerCase();
        const id = el.id ? `#${CSS.escape(el.id)}` : '';
        if (id) return `${tag}${id}`;
        const cls = Array.from(el.classList || []).slice(0, 2).map((item) => `.${CSS.escape(item)}`).join('');
        return `${tag}${cls}`;
      }

      return Array.from(document.querySelectorAll('a[href]')).map((a) => ({
        href: a.href,
        text: a.innerText || a.getAttribute('aria-label') || a.getAttribute('title') || '',
        selector: cssPath(a),
      }));
    });

    for (const item of pageLinks) {
      if (links.length >= maxLinks) break;
      try {
        const parsed = new URL(item.href);
        if (!['http:', 'https:'].includes(parsed.protocol)) continue;
        if (sameOrigin && parsed.origin !== start.origin) continue;
        addUniqueLink(links, seen, item);
      } catch {
        // Ignore invalid hrefs.
      }
    }

    return {
      ok: true,
      url,
      finalUrl: page.url(),
      sameOrigin,
      maxLinks,
      links,
      timings: {
        totalMs: +(performance.now() - startedAt).toFixed(2),
      },
    };
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

export async function runSiteQa(options = {}) {
  const startedAt = performance.now();
  const {
    url,
    urls,
    maxLinks = 8,
    sameOrigin = true,
    outputDir,
    goal,
    waitMs,
    expectedText,
    viewports,
    screenshot = false,
    headless = true,
    actions,
    llm,
  } = options;

  const discovered = Array.isArray(urls) && urls.length > 0
    ? {
        ok: true,
        url: url || urls[0],
        finalUrl: url || urls[0],
        sameOrigin,
        maxLinks: urls.length,
        links: urls.map((item, index) => ({ url: normalizeUrl(item), text: `provided ${index + 1}`, selector: null })),
        timings: { totalMs: 0 },
      }
    : await discoverSiteLinks({ url, maxLinks, sameOrigin, waitMs, headless });

  if (outputDir) await fs.mkdir(outputDir, { recursive: true });

  const routeReports = [];
  for (const [index, link] of discovered.links.entries()) {
    const routeOutputDir = outputDir
      ? path.join(outputDir, `${String(index + 1).padStart(2, '0')}_${safeDirName(new URL(link.url).pathname || 'home')}`)
      : undefined;

    const report = await runUiQa({
      url: link.url,
      goal: goal || `Review ${link.url} for launch-blocking UI, runtime, network, accessibility, and layout issues.`,
      outputDir: routeOutputDir,
      waitMs,
      expectedText,
      viewports,
      actions,
      screenshot,
      headless,
      llm,
    });

    routeReports.push({
      link,
      summary: summarizeForMcp(report),
    });
  }

  const findings = routeReports.flatMap((route) => (
    route.summary.findings || []
  ).map((finding) => ({
    route: route.link.url,
    ...finding,
  })));

  const tokenSavings = routeReports.reduce((acc, route) => {
    acc.rawEvidenceApproxTokens += route.summary.tokenSavings?.rawEvidenceApproxTokens || 0;
    acc.compactReportApproxTokens += route.summary.tokenSavings?.compactReportApproxTokens || 0;
    acc.savedApproxTokens += route.summary.tokenSavings?.savedApproxTokens || 0;
    return acc;
  }, {
    rawEvidenceApproxTokens: 0,
    compactReportApproxTokens: 0,
    savedApproxTokens: 0,
  });

  const aggregate = {
    ok: findings.length === 0,
    target: {
      url: url || discovered.url,
      routeCount: routeReports.length,
    },
    discovery: discovered,
    timings: {
      totalMs: +(performance.now() - startedAt).toFixed(2),
    },
    findingCount: findings.length,
    findings,
    tokenSavings,
    routeReports,
  };

  if (outputDir) {
    const reportPath = path.join(outputDir, 'site-report.json');
    await fs.writeFile(reportPath, JSON.stringify(aggregate, null, 2));
    aggregate.reportPath = path.resolve(reportPath);
  }

  return aggregate;
}

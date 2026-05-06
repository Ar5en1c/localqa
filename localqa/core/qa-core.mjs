import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
];

function nowIso() {
  return new Date().toISOString();
}

function createRunId() {
  return `localqa-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function sanitizeFilename(value) {
  return String(value || 'viewport').replace(/[^a-z0-9_.-]+/gi, '_').replace(/^_+|_+$/g, '') || 'viewport';
}

function trimText(value, max = 180) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

async function ensureWritableDir(dir) {
  const requested = path.resolve(dir);
  try {
    await fs.mkdir(requested, { recursive: true });
    return { dir: requested, fallback: null };
  } catch (err) {
    if (!['EACCES', 'EPERM'].includes(err?.code)) throw err;
    const fallback = path.join(os.tmpdir(), 'localqa-reports', path.basename(requested) || 'report');
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

function normalizeViewports(viewports) {
  if (!Array.isArray(viewports) || viewports.length === 0) return DEFAULT_VIEWPORTS;
  return viewports
    .map((item, index) => ({
      name: trimText(item?.name || `viewport_${index + 1}`, 32),
      width: Number.parseInt(item?.width, 10),
      height: Number.parseInt(item?.height, 10),
    }))
    .filter((item) => item.width > 0 && item.height > 0);
}

function dedupeFindings(findings) {
  const seen = new Set();
  const out = [];
  for (const finding of findings) {
    const key = [
      finding.severity,
      finding.category,
      finding.selector || '',
      finding.title,
      finding.viewport || '',
      finding.evidence?.href || '',
      finding.evidence?.src || '',
    ].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(finding);
  }
  return out;
}

function severityRank(severity) {
  return { critical: 0, high: 1, medium: 2, low: 3, info: 4 }[severity] ?? 5;
}

function sortFindings(findings) {
  return findings.slice().sort((a, b) => {
    const rank = severityRank(a.severity) - severityRank(b.severity);
    if (rank) return rank;
    return String(a.title).localeCompare(String(b.title));
  });
}

function buildFinding(severity, category, title, evidence = {}) {
  return {
    severity,
    category,
    title,
    evidence,
    selector: evidence.selector || null,
    viewport: evidence.viewport || null,
  };
}

function normalizeActions(actions) {
  if (!Array.isArray(actions)) return [];
  return actions
    .map((action, index) => ({
      type: trimText(action?.type || action?.action || '', 32).toLowerCase(),
      selector: trimText(action?.selector || '', 240),
      value: action?.value == null ? '' : String(action.value),
      text: action?.text == null ? '' : String(action.text),
      key: action?.key == null ? '' : String(action.key),
      timeoutMs: Number.parseInt(action?.timeoutMs, 10) || 8000,
      waitAfterMs: Number.parseInt(action?.waitAfterMs, 10) || 150,
      index,
    }))
    .filter((action) => action.type);
}

async function performActions(page, actions) {
  const results = [];
  for (const action of normalizeActions(actions)) {
    const startedAt = performance.now();
    try {
      if (action.type === 'wait') {
        await page.waitForTimeout(Number.parseInt(action.value || action.waitAfterMs, 10) || action.waitAfterMs);
      } else if (action.type === 'wait_for_text' || action.type === 'assert_text') {
        const text = action.text || action.value;
        await page.getByText(text, { exact: false }).first().waitFor({ timeout: action.timeoutMs });
      } else if (action.type === 'click') {
        await page.locator(action.selector).first().click({ timeout: action.timeoutMs });
      } else if (action.type === 'fill') {
        await page.locator(action.selector).first().fill(action.value, { timeout: action.timeoutMs });
      } else if (action.type === 'press') {
        await page.locator(action.selector).first().press(action.key || action.value, { timeout: action.timeoutMs });
      } else if (action.type === 'select') {
        await page.locator(action.selector).first().selectOption(action.value, { timeout: action.timeoutMs });
      } else if (action.type === 'check') {
        await page.locator(action.selector).first().check({ timeout: action.timeoutMs });
      } else if (action.type === 'uncheck') {
        await page.locator(action.selector).first().uncheck({ timeout: action.timeoutMs });
      } else {
        throw new Error(`Unsupported action type: ${action.type}`);
      }
      if (action.waitAfterMs > 0) await page.waitForTimeout(action.waitAfterMs);
      results.push({
        ok: true,
        type: action.type,
        selector: action.selector || null,
        value: action.type === 'fill' ? '[redacted]' : trimText(action.value || action.text || action.key, 120),
        durationMs: +(performance.now() - startedAt).toFixed(2),
      });
    } catch (err) {
      results.push({
        ok: false,
        type: action.type,
        selector: action.selector || null,
        value: action.type === 'fill' ? '[redacted]' : trimText(action.value || action.text || action.key, 120),
        error: err?.message || String(err),
        durationMs: +(performance.now() - startedAt).toFixed(2),
      });
    }
  }
  return results;
}

function buildDeterministicFindings(viewportReports, expectedText = []) {
  const findings = [];
  const expected = Array.isArray(expectedText)
    ? expectedText.map((item) => trimText(item, 240)).filter(Boolean)
    : [];

  for (const report of viewportReports) {
    const vp = report.viewport?.name || 'unknown';
    for (const action of report.actionResults || []) {
      if (!action.ok) {
        findings.push(buildFinding('high', 'interaction', `Scripted action failed: ${action.type}`, {
          viewport: vp,
          selector: action.selector,
          value: action.value,
          error: action.error,
        }));
      }
    }
    for (const error of report.pageErrors || []) {
      findings.push(buildFinding('critical', 'runtime', 'Browser page error', {
        viewport: vp,
        message: error,
      }));
    }
    for (const msg of report.consoleErrors || []) {
      findings.push(buildFinding('high', 'console', 'Console error detected', {
        viewport: vp,
        message: msg.text,
        location: msg.location,
      }));
    }
    for (const failed of report.failedRequests || []) {
      findings.push(buildFinding('medium', 'network', 'Network request failed', {
        viewport: vp,
        url: failed.url,
        method: failed.method,
        failure: failed.failure,
      }));
    }
    for (const response of report.badResponses || []) {
      findings.push(buildFinding('medium', 'network', `HTTP ${response.status} response`, {
        viewport: vp,
        url: response.url,
        status: response.status,
      }));
    }
    if (report.dom?.hasHorizontalOverflow) {
      findings.push(buildFinding('high', 'layout', 'Page has horizontal overflow', {
        viewport: vp,
        bodyScrollWidth: report.dom.bodyScrollWidth,
        innerWidth: report.dom.innerWidth,
      }));
    }
    if (!report.dom?.hasHeading) {
      findings.push(buildFinding('low', 'content', 'No visible heading found', {
        viewport: vp,
      }));
    }
    for (const item of report.dom?.clippedInteractive || []) {
      findings.push(buildFinding('high', 'layout', 'Interactive element is clipped or offscreen', {
        viewport: vp,
        selector: item.selector,
        text: item.text,
        rect: item.rect,
      }));
    }
    for (const item of report.dom?.unlabeledControls || []) {
      findings.push(buildFinding('medium', 'accessibility', 'Interactive control has no accessible label', {
        viewport: vp,
        selector: item.selector,
        tag: item.tag,
        href: item.href,
        rect: item.rect,
      }));
    }
    for (const item of report.dom?.imagesMissingAlt || []) {
      findings.push(buildFinding('medium', 'accessibility', 'Image is missing alt text', {
        viewport: vp,
        selector: item.selector,
        src: item.src,
        rect: item.rect,
      }));
    }
    for (const item of report.dom?.brokenImages || []) {
      findings.push(buildFinding('medium', 'content', 'Image failed to load', {
        viewport: vp,
        selector: item.selector,
        src: item.src,
        rect: item.rect,
      }));
    }
    for (const text of expected) {
      if (!report.dom?.visibleText?.toLowerCase().includes(text.toLowerCase())) {
        findings.push(buildFinding('medium', 'content', 'Expected text not visible', {
          viewport: vp,
          expectedText: text,
        }));
      }
    }
  }

  return sortFindings(dedupeFindings(findings));
}

async function importPlaywright() {
  try {
    return await import('playwright');
  } catch (err) {
    const hint = [
      'Playwright is required for LocalQA.',
      'Install it with:',
      '  npm install -D playwright',
      '  npx playwright install chromium',
    ].join('\n');
    const wrapped = new Error(`${hint}\n\nOriginal import error: ${err?.message || err}`);
    wrapped.cause = err;
    throw wrapped;
  }
}

async function collectViewportEvidence(page, options) {
  const startedAt = performance.now();
  const { url, viewport, waitMs, outputDir, screenshot, actions = [] } = options;
  const consoleMessages = [];
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  const badResponses = [];

  page.on('console', (msg) => {
    const entry = {
      type: msg.type(),
      text: trimText(msg.text(), 1000),
      location: msg.location(),
    };
    consoleMessages.push(entry);
    if (['error', 'assert'].includes(entry.type)) consoleErrors.push(entry);
  });
  page.on('pageerror', (err) => {
    pageErrors.push(trimText(err?.stack || err?.message || err, 1200));
  });
  page.on('requestfailed', (request) => {
    failedRequests.push({
      url: request.url(),
      method: request.method(),
      failure: request.failure()?.errorText || 'unknown',
    });
  });
  page.on('response', (response) => {
    const status = response.status();
    if (status >= 400) {
      badResponses.push({
        url: response.url(),
        status,
      });
    }
  });

  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  const navStart = performance.now();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  if (waitMs > 0) await page.waitForTimeout(waitMs);
  const navigationMs = performance.now() - navStart;
  const actionResults = await performActions(page, actions);

  const screenshotPath = screenshot && outputDir
    ? path.join(outputDir, 'screenshots', `${sanitizeFilename(viewport.name)}.png`)
    : null;
  if (screenshotPath) {
    await fs.mkdir(path.dirname(screenshotPath), { recursive: true });
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => null);
  }

  const dom = await page.evaluate(() => {
    const selectorFor = (element) => {
      if (!element || !element.tagName) return '';
      const id = element.id ? `#${CSS.escape(element.id)}` : '';
      if (id) return `${element.tagName.toLowerCase()}${id}`;
      const testId = element.getAttribute('data-testid') || element.getAttribute('data-test');
      if (testId) return `${element.tagName.toLowerCase()}[data-testid="${testId}"]`;
      const name = element.getAttribute('name');
      if (name) return `${element.tagName.toLowerCase()}[name="${name}"]`;
      const href = element.getAttribute('href');
      if (element.tagName.toLowerCase() === 'a' && href) return `a[href="${href.slice(0, 120)}"]`;
      const src = element.getAttribute('src');
      if (element.tagName.toLowerCase() === 'img' && src) return `img[src="${src.slice(0, 120)}"]`;
      const cls = String(element.className || '').split(/\s+/).filter(Boolean).slice(0, 2).join('.');
      return cls ? `${element.tagName.toLowerCase()}.${cls}` : element.tagName.toLowerCase();
    };
    const rectFor = (element) => {
      const rect = element.getBoundingClientRect();
      return {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        right: Math.round(rect.right),
        bottom: Math.round(rect.bottom),
      };
    };
    const isVisible = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== 'hidden' &&
        style.display !== 'none' &&
        Number(style.opacity || 1) !== 0 &&
        rect.width > 0 &&
        rect.height > 0;
    };
    const labelFor = (element) => {
      const id = element.id;
      const label = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
      return [
        element.getAttribute('aria-label'),
        element.getAttribute('title'),
        element.getAttribute('placeholder'),
        element.textContent,
        label?.textContent,
      ].map((value) => String(value || '').replace(/\s+/g, ' ').trim()).find(Boolean) || '';
    };
    const interesting = Array.from(document.querySelectorAll('button,a,input,textarea,select,[role],h1,h2,h3,img'));
    const clippedInteractive = [];
    const unlabeledControls = [];
    const brokenImages = [];
    const imagesMissingAlt = [];
    const elements = [];
    for (const element of interesting) {
      if (!isVisible(element)) continue;
      const rect = rectFor(element);
      const selector = selectorFor(element);
      const tag = element.tagName.toLowerCase();
      const role = element.getAttribute('role') || '';
      const text = labelFor(element).slice(0, 160);
      const href = tag === 'a' ? element.getAttribute('href') || '' : '';
      const src = tag === 'img' && element instanceof HTMLImageElement ? element.currentSrc || element.src || element.getAttribute('src') || '' : '';
      const interactive = ['button', 'a', 'input', 'textarea', 'select'].includes(tag) ||
        ['button', 'link', 'textbox', 'checkbox', 'combobox', 'menuitem', 'tab'].includes(role);
      elements.push({ selector, tag, role, text, href, src, rect });
      if (interactive && (rect.x < -2 || rect.right > window.innerWidth + 2 || rect.y < -2)) {
        clippedInteractive.push({ selector, tag, text, rect });
      }
      if (interactive && !text) {
        unlabeledControls.push({ selector, tag, role, href, rect });
      }
      if (tag === 'img' && element instanceof HTMLImageElement && !element.hasAttribute('alt')) {
        imagesMissingAlt.push({ selector, src, rect });
      }
      if (tag === 'img' && element instanceof HTMLImageElement && !element.complete) {
        brokenImages.push({ selector, src: element.currentSrc || element.src, rect });
      }
      if (tag === 'img' && element instanceof HTMLImageElement && element.naturalWidth === 0) {
        brokenImages.push({ selector, src: element.currentSrc || element.src, rect });
      }
    }
    const headings = Array.from(document.querySelectorAll('h1,h2,h3,[role="heading"]'))
      .filter(isVisible)
      .map((element) => labelFor(element))
      .filter(Boolean)
      .slice(0, 20);
    return {
      title: document.title,
      url: location.href,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      bodyScrollWidth: document.documentElement.scrollWidth,
      bodyScrollHeight: document.documentElement.scrollHeight,
      hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 2,
      visibleText: document.body?.innerText?.replace(/\s+/g, ' ').trim().slice(0, 10000) || '',
      hasHeading: headings.length > 0,
      headings,
      elements: elements.slice(0, 120),
      clippedInteractive: clippedInteractive.slice(0, 30),
      unlabeledControls: unlabeledControls.slice(0, 30),
      imagesMissingAlt: imagesMissingAlt.slice(0, 30),
      brokenImages: brokenImages.slice(0, 30),
    };
  });

  let accessibility = null;
  try {
    accessibility = await page.accessibility.snapshot({ interestingOnly: true });
  } catch {
    accessibility = null;
  }

  return {
    viewport,
    navigationMs: +navigationMs.toFixed(2),
    totalMs: +(performance.now() - startedAt).toFixed(2),
    screenshotPath,
    actionResults,
    consoleMessages: consoleMessages.slice(0, 100),
    consoleErrors: consoleErrors.slice(0, 50),
    pageErrors: pageErrors.slice(0, 50),
    failedRequests: failedRequests.slice(0, 50),
    badResponses: badResponses.slice(0, 50),
    dom,
    accessibility,
  };
}

function isUnprovenNetworkSignal(finding) {
  const status = Number(finding?.evidence?.status);
  return finding?.category === 'network' && status >= 400;
}

function compactFindingForLlm(finding) {
  const evidence = finding?.evidence || {};
  const parts = [
    finding?.severity,
    finding?.category,
    finding?.title,
    evidence.status ? `status=${evidence.status}` : '',
    evidence.url ? `url=${trimText(evidence.url, 120)}` : '',
    evidence.message ? `message=${trimText(evidence.message, 120)}` : '',
    finding?.selector ? `selector=${trimText(finding.selector, 80)}` : '',
    finding?.viewport || evidence.viewport ? `viewport=${finding?.viewport || evidence.viewport}` : '',
  ].filter(Boolean);
  return parts.join(' | ');
}

function dedupeObjectsByKey(items, keyFn, limit = 20) {
  const seen = new Set();
  const out = [];
  for (const item of items || []) {
    const key = keyFn(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

function compactSignalUrl(url) {
  try {
    const parsed = new URL(String(url || ''));
    return `${parsed.origin}${parsed.pathname}`.slice(0, 140);
  } catch {
    return trimText(url, 140);
  }
}

function compactEvidenceForLlm(report) {
  const findings = report.findings.slice(0, 40);
  const confirmedFindings = dedupeStrings(
    findings
      .filter((finding) => !isUnprovenNetworkSignal(finding))
      .map(compactFindingForLlm),
  ).slice(0, 16);
  const networkSignals = dedupeObjectsByKey(
    findings.filter(isUnprovenNetworkSignal),
    (finding) => `${finding.evidence?.status}|${compactSignalUrl(finding.evidence?.url)}`,
    16,
  ).map((finding) => `${finding.title} | status=${finding.evidence?.status} | url=${compactSignalUrl(finding.evidence?.url)}`);
  const consoleSignals = dedupeObjectsByKey(
    report.viewports.flatMap((vp) => (vp.consoleErrors || []).map((item) => ({
      viewport: vp.viewport?.name || 'unknown',
      text: trimText(item.message || item.text || item.type || '', 120),
      url: compactSignalUrl(item.location?.url || ''),
    }))),
    (item) => `${item.text}|${item.url}`,
    12,
  ).map((item) => `${item.text}${item.url ? ` | ${item.url}` : ''}`);
  const viewportFacts = report.viewports.map((vp) => ({
    viewport: vp.viewport?.name || 'unknown',
    title: trimText(vp.dom?.title, 80),
    url: trimText(vp.dom?.url, 120),
    headings: (vp.dom?.headings || []).slice(0, 4).map((heading) => trimText(heading, 80)),
    consoleErrors: vp.consoleErrors?.length || 0,
    badResponses: vp.badResponses?.length || 0,
    unlabeledControls: vp.dom?.unlabeledControls?.length || 0,
    imagesMissingAlt: vp.dom?.imagesMissingAlt?.length || 0,
    clippedInteractive: vp.dom?.clippedInteractive?.length || 0,
    horizontalOverflow: Boolean(vp.dom?.hasHorizontalOverflow),
  }));
  return {
    target: report.target,
    goal: trimText(report.goal, 120),
    counts: {
      findings: report.findings.length,
      confirmedEvidenceCandidates: confirmedFindings.length,
      rawNetworkSignals: networkSignals.length,
      consoleSignals: consoleSignals.length,
    },
    confirmedEvidenceCandidates: confirmedFindings,
    rawNetworkSignals: networkSignals,
    consoleSignals,
    viewportFacts,
  };
}

function compactForLlm(report) {
  return {
    task: 'Summarize likely fix areas and next tests. Deterministic QA code classifies confirmedIssues and unprovenSignals.',
    evidence: compactEvidenceForLlm(report),
  };
}

function parseLooseJsonObject(text) {
  const raw = String(text || '').trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

function isRawHttpSignalText(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value || {});
  return /\bHTTP\s+[45]\d\d\b/i.test(text) ||
    /\bstatus(?:\s+of)?\s*[:=]?\s*[45]\d\d\b/i.test(text) ||
    /server\s+responded\s+with\b.*\b[45]\d\d\b/i.test(text) ||
    /(?:^|[\s|()[\]{}:;,"'-])(?:[45]\d\d)(?:$|[\s|()[\]{}:;,"'-])/i.test(text);
}

function isJourneyFailureClaim(value) {
  const text = String(value || '');
  return /\b(broken|failed|failure|cannot|unable|blocked)\b.*\b(login|log in|signup|sign up|authentication|auth|payment|checkout|navigation)\b/i.test(text) ||
    /\b(login|log in|signup|sign up|authentication|auth|payment|checkout|navigation)\b.*\b(broken|failed|failure|cannot|unable|blocked)\b/i.test(text);
}

function isGenericBreakageClaim(value) {
  const text = String(value || '');
  return /\b(broken|failed|failure|cannot|unable|blocked|unusable|not working|does not work|doesn't work)\b.*\b(functionality|flow|feature|page|site|app|form|loading|load|experience)\b/i.test(text) ||
    /\b(functionality|flow|feature|page|site|app|form|loading|load|experience)\b.*\b(broken|failed|failure|cannot|unable|blocked|unusable|not working|does not work|doesn't work)\b/i.test(text);
}

function requiresScriptedProofClaim(value) {
  return isJourneyFailureClaim(value) || isGenericBreakageClaim(value);
}

function hasExplicitJourneyFailure(value) {
  const text = String(value || '');
  return /\bscripted action failed\b/i.test(text) ||
    /\bexpected text not visible\b/i.test(text) ||
    /\baction\b.*\bfailed\b/i.test(text) ||
    /\btransition\b.*\bfailed\b/i.test(text);
}

function dedupeStrings(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const text = String(value || '').trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

function deterministicConfirmedIssueTexts(report) {
  if (!report || !Array.isArray(report.findings)) return [];
  const confirmedCategories = new Set(['accessibility', 'layout', 'runtime', 'interaction', 'content']);
  return report.findings
    .filter((finding) => confirmedCategories.has(finding.category))
    .map(compactFindingForLlm)
    .filter((text) => text && !isRawHttpSignalText(text));
}

function deterministicUnprovenSignalTexts(report) {
  if (!report || !Array.isArray(report.findings)) return [];
  return report.findings
    .filter(isUnprovenNetworkSignal)
    .map(compactFindingForLlm)
    .filter(Boolean);
}

function sanitizeLlmTriage(text, report = null) {
  const parsed = parseLooseJsonObject(text);
  if (!parsed || typeof parsed !== 'object') return null;
  const confirmed = Array.isArray(parsed.confirmedIssues) ? parsed.confirmedIssues : [];
  const unproven = Array.isArray(parsed.unprovenSignals) ? parsed.unprovenSignals : [];
  const safeConfirmed = [];
  const movedSignals = [];
  for (const item of confirmed) {
    if (isRawHttpSignalText(item)) movedSignals.push(item);
    else safeConfirmed.push(item);
  }
  const deterministicConfirmed = deterministicConfirmedIssueTexts(report);
  const deterministicUnproven = deterministicUnprovenSignalTexts(report);
  const passiveNetworkPresent = movedSignals.length > 0 ||
    deterministicUnproven.length > 0 ||
    unproven.some(isRawHttpSignalText);
  if (passiveNetworkPresent) {
    for (let index = safeConfirmed.length - 1; index >= 0; index -= 1) {
      const item = safeConfirmed[index];
      if (!hasExplicitJourneyFailure(item) && requiresScriptedProofClaim(item)) {
        safeConfirmed.splice(index, 1);
        movedSignals.push(`${item} (needs scripted validation)`);
      }
    }
  }
  const explicitJourneyFailure = safeConfirmed.some(hasExplicitJourneyFailure);
  const topRisks = Array.isArray(parsed.topRisks) ? parsed.topRisks : [];
  const safeTopRisks = passiveNetworkPresent && !explicitJourneyFailure
    ? topRisks.filter((item) => !requiresScriptedProofClaim(item))
    : topRisks;
  const nextTests = Array.isArray(parsed.nextTests) ? parsed.nextTests.slice() : [];
  if (passiveNetworkPresent && !explicitJourneyFailure) {
    nextTests.push('Verify affected flows with scripted user actions before calling passive network signals product failures.');
  }
  return {
    ...parsed,
    confirmedIssues: dedupeStrings([...safeConfirmed, ...deterministicConfirmed]),
    unprovenSignals: dedupeStrings([...unproven, ...movedSignals, ...deterministicUnproven]),
    topRisks: safeTopRisks,
    nextTests,
    guardrailsApplied: [
      ...(movedSignals.length > 0 ? [`Moved ${movedSignals.length} raw HTTP signal(s) from confirmedIssues to unprovenSignals.`] : []),
      ...(deterministicConfirmed.length > 0 ? [`Merged ${deterministicConfirmed.length} deterministic non-network issue(s) into confirmedIssues.`] : []),
      ...(deterministicUnproven.length > 0 ? [`Merged ${deterministicUnproven.length} deterministic raw network signal(s) into unprovenSignals.`] : []),
      ...(passiveNetworkPresent && !explicitJourneyFailure ? ['Filtered unverified broken-flow claims from passive network evidence.'] : []),
    ],
  };
}

async function summarizeWithOllama(report, llm) {
  if (!llm?.enabled || !llm?.model) return null;
  const provider = llm.provider || 'ollama';
  const isOpenAiCompatible = ['openai-compatible', 'llama-server', 'openai'].includes(provider);
  const endpoint = llm.endpoint || (isOpenAiCompatible
    ? 'http://127.0.0.1:18081/v1/chat/completions'
    : 'http://127.0.0.1:11434/api/chat');
  const prompt = [
    'You are LocalQA summarizer for browser QA. Use only the provided evidence.',
    'Return compact raw JSON with keys: summary, likelyFixAreas, topRisks, nextTests, confidence.',
    'Do not classify confirmedIssues or unprovenSignals; the deterministic QA layer fills those.',
    'Use exactly one terse string in each array.',
    'Keep summary under 10 words and the full response under 55 words.',
    'Return raw JSON only. Do not wrap the response in markdown fences.',
    'Never say broken login/auth/authentication unless evidence lists a failed scripted action.',
    'Never say broken functionality or broken flow from passive network evidence alone.',
    'For passive 4xx/5xx evidence, say network signals need validation.',
    '',
    JSON.stringify(compactForLlm(report), null, 2),
  ].join('\n');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), llm.timeoutMs || 30000);
  try {
    const body = isOpenAiCompatible
      ? {
          model: llm.model,
          messages: [
            {
              role: 'user',
              content: prompt,
            },
          ],
          temperature: Number.isFinite(Number(llm.temperature)) ? Number(llm.temperature) : 0,
          ...(Number.isFinite(Number(llm.topK)) ? { top_k: Number(llm.topK) } : {}),
          ...(Number.isFinite(Number(llm.topP)) ? { top_p: Number(llm.topP) } : {}),
          max_tokens: llm.maxTokens || 384,
          response_format: llm.responseFormat || { type: 'json_object' },
        }
      : {
          model: llm.model,
          messages: [
            {
              role: 'user',
              content: prompt,
            },
          ],
          stream: false,
          think: false,
          ...(llm.responseFormat ? { format: llm.responseFormat } : {}),
          options: {
            temperature: Number.isFinite(Number(llm.temperature)) ? Number(llm.temperature) : 0,
            ...(Number.isFinite(Number(llm.topK)) ? { top_k: Number(llm.topK) } : {}),
            ...(Number.isFinite(Number(llm.topP)) ? { top_p: Number(llm.topP) } : {}),
            num_predict: llm.maxTokens || 384,
          },
        };
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      return {
        ok: false,
        provider,
        error: `${provider} HTTP ${res.status}`,
      };
    }
    const json = await res.json();
    const text = String(
      isOpenAiCompatible
        ? json.choices?.[0]?.message?.content || json.choices?.[0]?.text || ''
        : json.message?.content || json.response || '',
    ).trim();
    return {
      ok: true,
      provider,
      model: llm.model,
      text,
      sanitized: sanitizeLlmTriage(text, report),
      stats: {
        totalDurationNs: json.total_duration || null,
        loadDurationNs: json.load_duration || null,
        promptEvalCount: json.prompt_eval_count || null,
        evalCount: json.eval_count || null,
        usage: json.usage || null,
        timings: json.timings || null,
      },
    };
  } catch (err) {
    return {
      ok: false,
      provider,
      model: llm.model,
      error: err?.name === 'AbortError' ? `${provider} request timed out` : String(err?.message || err),
    };
  } finally {
    clearTimeout(timer);
  }
}

function estimateTokenSavings(report) {
  const rawEvidenceChars = JSON.stringify(report.viewports || []).length;
  const compactReportChars = JSON.stringify({
    target: report.target,
    goal: report.goal,
    findings: report.findings,
    llmSummary: report.llmSummary,
  }).length;
  return {
    rawEvidenceApproxTokens: Math.ceil(rawEvidenceChars / 4),
    compactReportApproxTokens: Math.ceil(compactReportChars / 4),
    savedApproxTokens: Math.max(0, Math.ceil((rawEvidenceChars - compactReportChars) / 4)),
  };
}

export async function runUiQa(options = {}) {
  const startedAt = performance.now();
  const runId = options.runId || createRunId();
  const url = String(options.url || '').trim();
  if (!url) throw new Error('runUiQa requires url.');
  const goal = trimText(options.goal || 'Inspect the page for visible UI, runtime, network, and accessibility issues.', 1000);
  const viewports = normalizeViewports(options.viewports);
  const waitMs = Number.isFinite(Number(options.waitMs)) ? Number(options.waitMs) : 500;
  const screenshot = options.screenshot !== false;
  const requestedOutputDir = options.outputDir
    ? path.resolve(options.outputDir)
    : path.resolve('reports/localqa', runId);
  const outputDirResult = await ensureWritableDir(requestedOutputDir);
  const outputDir = outputDirResult.dir;

  const importStartedAt = performance.now();
  const { chromium } = await importPlaywright();
  const playwrightImportMs = performance.now() - importStartedAt;
  const launchStartedAt = performance.now();
  const browser = await chromium.launch({
    headless: options.headless !== false,
  });
  const browserLaunchMs = performance.now() - launchStartedAt;

  const viewportReports = [];
  try {
    for (const viewport of viewports) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: 1,
      });
      const page = await context.newPage();
      try {
        const evidence = await collectViewportEvidence(page, {
          url,
          viewport,
          waitMs,
          outputDir,
          screenshot,
          actions: options.actions || [],
        });
        viewportReports.push(evidence);
      } finally {
        await context.close().catch(() => null);
      }
    }
  } finally {
    await browser.close().catch(() => null);
  }

  const report = {
    version: '0.1.0',
    tool: 'localqa',
    runId,
    generatedAt: nowIso(),
    target: { url },
    goal,
    timings: {
      deterministicMs: +(performance.now() - startedAt).toFixed(2),
      totalMs: null,
      llmMs: null,
      playwrightImportMs: +playwrightImportMs.toFixed(2),
      browserLaunchMs: +browserLaunchMs.toFixed(2),
    },
    viewports: viewportReports,
    findings: buildDeterministicFindings(viewportReports, options.expectedText || []),
    llmSummary: null,
    tokenSavings: null,
    warnings: outputDirResult.fallback
      ? [{ type: 'output_dir_fallback', ...outputDirResult.fallback }]
      : [],
  };

  const llmStartedAt = performance.now();
  report.llmSummary = await summarizeWithOllama(report, options.llm || null);
  report.timings.llmMs = +(performance.now() - llmStartedAt).toFixed(2);
  report.timings.totalMs = +(performance.now() - startedAt).toFixed(2);
  report.tokenSavings = estimateTokenSavings(report);

  const reportPath = path.join(outputDir, 'report.json');
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
  return {
    ...report,
    reportPath,
  };
}

export function summarizeForMcp(report) {
  return {
    runId: report.runId,
    target: report.target,
    goal: report.goal,
    reportPath: report.reportPath,
    timings: report.timings,
    findingCount: report.findings.length,
    findings: report.findings.slice(0, 20),
    llmSummary: report.llmSummary,
    tokenSavings: report.tokenSavings,
  };
}

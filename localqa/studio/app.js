const $ = (selector) => document.querySelector(selector);

const state = {
  lastResult: null,
};

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function findFindings(payload) {
  if (Array.isArray(payload?.report?.findings)) return payload.report.findings;
  if (Array.isArray(payload?.findings)) return payload.findings;
  return [];
}

function renderResult(payload) {
  state.lastResult = payload;
  const findings = findFindings(payload);
  const report = payload.report || payload;
  const savings = report.tokenSavings || {};
  const summary = $('#summary');
  const runMeta = $('#runMeta');

  runMeta.textContent = `${payload.runKind || 'run'} | ${payload.reviewMode || 'fast'} | ${findings.length} findings`;
  summary.className = `summary ${findings.length ? 'fail' : 'pass'}`;
  summary.innerHTML = `
    <strong>${findings.length ? 'Issues found' : 'No deterministic issues found'}</strong><br>
    Report: <code>${escapeHtml(report.reportPath || report?.target?.url || 'not written')}</code><br>
    Token savings: raw ${savings.rawEvidenceApproxTokens ?? 'n/a'} -> compact ${savings.compactReportApproxTokens ?? 'n/a'}.
    ${payload.modelReview ? `<br>Model review: ${escapeHtml(payload.modelReview.ok ? 'completed' : payload.modelReview.error || 'failed')}` : ''}
  `;

  $('#findings').innerHTML = findings.map((finding) => {
    const evidence = finding.evidence || {};
    const url = evidence.url || evidence.location?.url || finding.route || '';
    const message = evidence.message || evidence.failure || evidence.expectedText || evidence.status || '';
    return `
      <article class="finding ${escapeHtml(finding.severity)}">
        <strong>${escapeHtml(finding.severity)} / ${escapeHtml(finding.category)}: ${escapeHtml(finding.title)}</strong>
        <div class="muted">${escapeHtml(finding.viewport || evidence.viewport || '')}</div>
        ${url ? `<code>${escapeHtml(url)}</code>` : ''}
        ${message ? `<p>${escapeHtml(message)}</p>` : ''}
      </article>
    `;
  }).join('');

  $('#rawJson').textContent = JSON.stringify(payload, null, 2);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const data = await response.json();
  if (!response.ok || data?.ok === false && data?.error) {
    throw new Error(data?.error || `HTTP ${response.status}`);
  }
  return data;
}

async function loadHealth() {
  const dot = $('#healthDot');
  const title = $('#healthTitle');
  const text = $('#healthText');
  try {
    const health = await api('/api/health');
    dot.className = `status-dot ${health.playwright?.ok ? 'ok' : 'bad'}`;
    title.textContent = health.playwright?.ok ? 'Runtime ready' : 'Playwright missing';
    const models = health.ollama?.models?.slice(0, 3).join(', ') || 'no local models detected';
    text.textContent = `Playwright ${health.playwright?.ok ? 'ok' : 'failed'} | Ollama ${health.ollama?.ok ? 'ok' : 'offline'} | ${models}`;
  } catch (err) {
    dot.className = 'status-dot bad';
    title.textContent = 'Runtime check failed';
    text.textContent = err.message;
  }
}

async function loadReports() {
  const root = $('#reports');
  root.innerHTML = '<p class="muted">Loading reports...</p>';
  try {
    const { reports } = await api('/api/reports');
    if (!reports.length) {
      root.innerHTML = '<p class="muted">No reports yet.</p>';
      return;
    }
    root.innerHTML = reports.slice(0, 12).map((report) => `
      <article class="report-card">
        <strong>${escapeHtml(report.name)}</strong>
        <span class="muted">${escapeHtml(new Date(report.modifiedAt).toLocaleString())}</span>
        <code>${escapeHtml(report.relativePath)}</code>
        <button type="button" data-report="${escapeHtml(report.relativePath)}">Open</button>
      </article>
    `).join('');
  } catch (err) {
    root.innerHTML = `<p class="muted">${escapeHtml(err.message)}</p>`;
  }
}

async function runQa(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = $('#runButton');
  const data = Object.fromEntries(new FormData(form).entries());
  data.screenshot = form.elements.screenshot.checked;
  data.sameOrigin = form.elements.sameOrigin.checked;
  button.disabled = true;
  button.textContent = 'Running...';
  $('#summary').className = 'summary';
  $('#summary').textContent = 'Running Playwright evidence collection...';
  $('#findings').innerHTML = '';
  try {
    const result = await api('/api/run', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    renderResult(result);
    await loadReports();
  } catch (err) {
    renderResult({
      ok: false,
      report: {
        findings: [{
          severity: 'critical',
          category: 'studio',
          title: 'Studio run failed',
          evidence: { message: err.message },
        }],
      },
    });
  } finally {
    button.disabled = false;
    button.textContent = 'Run QA';
  }
}

document.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-report]');
  if (!button) return;
  const reportPath = button.getAttribute('data-report');
  try {
    const report = await api(`/api/report?path=${encodeURIComponent(reportPath)}`);
    renderResult({ runKind: 'report', reviewMode: 'read', report });
  } catch (err) {
    renderResult({
      ok: false,
      report: {
        findings: [{
          severity: 'critical',
          category: 'studio',
          title: 'Could not open report',
          evidence: { message: err.message },
        }],
      },
    });
  }
});

$('#runForm').addEventListener('submit', runQa);
$('#refreshReports').addEventListener('click', loadReports);

loadHealth();
loadReports();

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

function trimText(value, max = 1000) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function approxTokens(value) {
  return Math.ceil(String(value || '').length / 4);
}

export async function ensureWritableDir(dir, fallbackPrefix = 'localqa-context') {
  const requested = path.resolve(dir);
  try {
    await fs.mkdir(requested, { recursive: true });
    return { dir: requested, fallback: null };
  } catch (err) {
    if (!['EACCES', 'EPERM'].includes(err?.code)) throw err;
    const fallback = path.join(os.tmpdir(), fallbackPrefix, path.basename(requested) || 'reports');
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

function normalizeLines(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim());
}

function dedupeLines(lines, max = 900) {
  const counts = new Map();
  const order = [];
  for (const line of lines) {
    const normalized = line.replace(/\s+/g, ' ').trim();
    if (!normalized) continue;
    if (!counts.has(normalized)) order.push(normalized);
    counts.set(normalized, (counts.get(normalized) || 0) + 1);
  }
  return order.slice(0, max).map((line) => ({
    text: line,
    count: counts.get(line) || 1,
  }));
}

function scoreLine(line, task = '') {
  const text = String(line || '');
  const lower = text.toLowerCase();
  const taskLower = String(task || '').toLowerCase();
  const codebaseTask = /\b(codebase|repo|repository|source|test command|package|maintenance|entrypoint|entry point|architecture)\b/i.test(taskLower) ||
    /\bOSS_CODEBASE_BENCHMARK_PROJECT\b/.test(text);
  let score = 0;
  if (codebaseTask) {
    if (/^(OSS_CODEBASE_BENCHMARK_PROJECT|ARCHIVE_URL|TASK|PACKAGE_SCRIPTS_JSON|TOP_DEPENDENCIES|FILE_TREE_HEAD|RG_LIKE_SIGNAL_LINES|SELECTED_FILE_EXCERPTS):/.test(text)) score += 14;
    if (/(^|\/)package\.json\b|(^|\/)README(\.|$)|(^|\/)(CONTRIBUTING|ARCHITECTURE|TESTING)(\.|$)/i.test(text)) score += 13;
    if (/"(test|test:[^"]+|build|lint|typecheck|dev|start)"\s*:/.test(text)) score += 12;
    if (/\b(src|lib|packages|test|tests|__tests__|docs|examples)\//i.test(text)) score += 5;
    if (/\b(middleware|router|schema|plugin|typescript|vitest|jest|mocha|tap|playwright|eslint|build|coverage)\b/i.test(text)) score += 5;
  }
  if (/\b(error|exception|failed|failure|fatal|panic|crash|timeout|denied|blocked)\b/i.test(text)) score += 9;
  if (/\b(warn|warning|deprecated|invalid|missing|required|unauthorized|forbidden)\b/i.test(text)) score += 5;
  if (/\b(?:http\s*)?[45]\d\d\b/.test(lower)) score += 7;
  if (/\b(typeerror|referenceerror|syntaxerror|rangeerror|traceback|stack trace)\b/i.test(text)) score += 8;
  if (/\b(click|fill|selector|locator|aria|role|button|input|form|viewport|overflow|clipped)\b/i.test(text)) score += 4;
  if (/https?:\/\//i.test(text)) score += 3;
  if (/^\s*(at\s+\S+|\w+Error:|File ".*", line \d+)/.test(text)) score += 3;
  const taskTerms = taskLower.split(/[^a-z0-9]+/).filter((item) => item.length > 3);
  for (const term of taskTerms.slice(0, 20)) {
    if (lower.includes(term)) score += 2;
  }
  if (codebaseTask && /\b(docs|guide|reference)\//i.test(text) && /\b(error|exception|failed|failure|timeout)\b/i.test(text)) score -= 4;
  if (text.length > 500) score -= 2;
  return score;
}

function takeBudgetedLines(items, maxChars) {
  const out = [];
  let chars = 0;
  const budget = Math.max(200, Number.parseInt(maxChars, 10) || 200);
  for (const item of items) {
    const suffix = item.count > 1 ? ` [repeated ${item.count}x]` : '';
    let line = `${item.text}${suffix}`;
    if (line.length + 1 > budget - chars) {
      const remaining = budget - chars - 24;
      if (remaining <= 80) break;
      line = `${line.slice(0, remaining)} [truncated]`;
    }
    if (chars + line.length + 1 > budget && out.length > 0) break;
    out.push(line);
    chars += line.length + 1;
    if (chars >= budget) break;
  }
  return out;
}

function classifyLines(items) {
  const sections = {
    errors: [],
    warnings: [],
    network: [],
    browserUi: [],
    urls: [],
    otherHighSignal: [],
  };

  for (const item of items) {
    const text = item.text;
    if (/\b(error|exception|failed|failure|fatal|panic|crash|traceback|stack trace|typeerror|referenceerror|syntaxerror)\b/i.test(text)) {
      sections.errors.push(item);
    } else if (/\b(warn|warning|deprecated|invalid|missing|required)\b/i.test(text)) {
      sections.warnings.push(item);
    }
    if (/\b(?:http\s*)?[45]\d\d\b/i.test(text) || /\b(GET|POST|PUT|PATCH|DELETE)\b.*https?:\/\//i.test(text)) {
      sections.network.push(item);
    }
    if (/\b(click|fill|selector|locator|aria|role|button|input|form|viewport|overflow|clipped)\b/i.test(text)) {
      sections.browserUi.push(item);
    }
    if (/https?:\/\//i.test(text)) {
      sections.urls.push(item);
    }
  }

  return sections;
}

function sha256Short(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 16);
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function normalizeDestination(destinationKind, destinationUrl) {
  const kind = destinationKind || 'unknown';
  const url = String(destinationUrl || '');
  const localDestination = kind === 'local_server' || isLocalDestination(url);
  const externalDestination = kind === 'main_llm' || kind === 'external_server' || (!!url && !localDestination);
  return {
    destinationKind: kind,
    destinationUrl: url,
    localDestination,
    externalDestination,
  };
}

function canonicalCompactPayload(compactText, sensitivity, destination) {
  const compactPayloadRedacted = sensitivity.sensitive || destination.externalDestination;
  return {
    compactPayloadRedacted,
    compactPayload: compactPayloadRedacted ? redactSensitiveText(compactText) : compactText,
  };
}

function buildHandoffProof({ artifactId, compactPayload, policy, destination }) {
  const ttlMs = Math.max(30_000, Number.parseInt(process.env.LOCALQA_GUARD_TTL_MS, 10) || 300_000);
  const issuedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  const compactPayloadSha256 = sha256Hex(compactPayload);
  const policyDigest = sha256Short(JSON.stringify({
    destinationKind: policy.destinationKind,
    sensitive: policy.sensitive,
    rawExternalSendAllowed: policy.rawExternalSendAllowed,
    compactExternalSendAllowed: policy.compactExternalSendAllowed,
    compactPayloadRedacted: policy.compactPayloadRedacted,
    localDestination: destination.localDestination,
    externalDestination: destination.externalDestination,
  }));
  const token = sha256Hex([
    artifactId,
    compactPayloadSha256,
    policyDigest,
    issuedAt,
    expiresAt,
  ].join('|'));
  return {
    version: 'guard.v1',
    artifactId,
    issuedAt,
    expiresAt,
    token,
    compactPayloadSha256,
    policyDigest,
  };
}

export function looksSensitive(text) {
  const value = String(text || '');
  const signals = [];
  if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(value)) signals.push('email');
  if (/\b(?:api[_-]?key|secret|token|password|authorization|bearer)\b/i.test(value)) signals.push('credential_keyword');
  if (/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\b/.test(value)) signals.push('jwt');
  if (/\b(?:sk-[A-Za-z0-9._-]{8,}|ghp_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|hf_[A-Za-z0-9_]{20,}|A(?:KIA|SIA)[A-Z0-9]{16})\b/.test(value)) signals.push('known_token_shape');
  if (/\bauthorization\s*:\s*basic\s+\S+/i.test(value)) signals.push('basic_auth');
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/i.test(value)) signals.push('private_key');
  if (/\bpostgres(?:ql)?:\/\/[^\s'"<>]+/i.test(value)) signals.push('database_url');
  if (/\b\d{3}[-.\s]\d{2}[-.\s]\d{4}\b/.test(value)) signals.push('ssn_like');
  if (/\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/.test(value)) signals.push('phone_like');
  return {
    sensitive: signals.length > 0,
    signals: Array.from(new Set(signals)),
  };
}

export function redactSensitiveText(text) {
  return String(text || '')
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gi, '[REDACTED_PRIVATE_KEY]')
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----/gi, '[REDACTED_PRIVATE_KEY]')
    .replace(/-----END [A-Z ]*PRIVATE KEY-----/gi, '[REDACTED_PRIVATE_KEY]')
    .replace(/\bpostgres(?:ql)?:\/\/[^\s'"<>]+/gi, 'postgresql://[REDACTED]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED_EMAIL]')
    .replace(/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\b/g, '[REDACTED_JWT]')
    .replace(/\b(?:sk-[A-Za-z0-9._-]{8,}|ghp_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|hf_[A-Za-z0-9_]{20,}|A(?:KIA|SIA)[A-Z0-9]{16})\b/g, '[REDACTED_TOKEN]')
    .replace(/\b(authorization\s*:\s*basic)\s+\S+/gi, '$1 [REDACTED]')
    .replace(/\b(authorization\s*:\s*bearer)\s+\S+/gi, '$1 [REDACTED]')
    .replace(/\b(api[_-]?key|secret|token|password)\s*[:=]\s*\S+/gi, '$1=[REDACTED]')
    .replace(/\b\d{3}[-.\s]\d{2}[-.\s]\d{4}\b/g, '[REDACTED_SSN_LIKE]')
    .replace(/\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g, '[REDACTED_PHONE]');
}

function isLocalDestination(url) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
  } catch {
    return false;
  }
}

export function analyzeContextDump(options = {}) {
  const startedAt = performance.now();
  const text = Array.isArray(options.chunks)
    ? options.chunks.map((chunk) => typeof chunk === 'string' ? chunk : `${chunk?.label || 'chunk'}\n${chunk?.text || ''}`).join('\n\n')
    : String(options.text || '');
  const mode = options.mode || 'context_cleanup';
  const task = trimText(options.task || options.goal || '', 1000);
  const contextBudgetTokens = Math.max(200, Math.min(Number.parseInt(options.contextBudgetTokens, 10) || 6000, 32000));
  const maxChars = Math.min(contextBudgetTokens * 4, Math.max(800, Math.floor(Math.max(text.length, 1) * 0.65)));
  const lines = normalizeLines(text);
  const deduped = dedupeLines(lines, Number.parseInt(options.maxLines, 10) || 1600);
  const ranked = deduped
    .map((item) => ({ ...item, score: scoreLine(item.text, task) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.count !== a.count) return b.count - a.count;
      return a.text.length - b.text.length;
    });
  const highSignal = ranked.filter((item) => item.score > 0);
  const selected = takeBudgetedLines(highSignal.length ? highSignal : ranked, maxChars);
  const sections = classifyLines(ranked);
  const sectionSummary = Object.fromEntries(Object.entries(sections).map(([key, value]) => [
    key,
    takeBudgetedLines(value.slice(0, 20), Math.min(1200, Math.floor(maxChars / 4))),
  ]));
  const compactText = [
    task ? `Task: ${task}` : '',
    `Mode: ${mode}`,
    '',
    'High-signal lines:',
    ...selected,
  ].filter(Boolean).join('\n');
  const inputTokens = approxTokens(text);
  const outputTokens = approxTokens(compactText);

  return {
    ok: true,
    mode,
    task: task || null,
    sourceLabel: options.sourceLabel || null,
    input: {
      chars: text.length,
      approxTokens: inputTokens,
      lines: lines.length,
      uniqueLines: deduped.length,
    },
    output: {
      chars: compactText.length,
      approxTokens: outputTokens,
      budgetTokens: contextBudgetTokens,
      compactText,
      sections: sectionSummary,
    },
    savings: {
      approxTokensSaved: Math.max(0, inputTokens - outputTokens),
      reductionRatio: inputTokens > 0 ? Math.max(0, +((1 - outputTokens / inputTokens) * 100).toFixed(2)) : 0,
    },
    tokenSavings: {
      rawEvidenceApproxTokens: inputTokens,
      compactReportApproxTokens: outputTokens,
      savedApproxTokens: Math.max(0, inputTokens - outputTokens),
      reductionRatio: inputTokens > 0 ? Math.max(0, +((1 - outputTokens / inputTokens) * 100).toFixed(2)) : 0,
    },
    timings: {
      totalMs: +(performance.now() - startedAt).toFixed(2),
    },
  };
}

export async function prepareLocalFirstHandoff(options = {}) {
  const text = Array.isArray(options.chunks)
    ? options.chunks.map((chunk) => typeof chunk === 'string' ? chunk : `${chunk?.label || 'chunk'}\n${chunk?.text || ''}`).join('\n\n')
    : String(options.text || '');
  const analysis = analyzeContextDump({
    ...options,
    mode: options.mode || 'handoff_gate',
  });
  const destination = normalizeDestination(options.destinationKind, options.destinationUrl);
  const destinationKind = destination.destinationKind;
  const destinationUrl = destination.destinationUrl;
  const localDestination = destination.localDestination;
  const externalDestination = destination.externalDestination;
  const sensitivity = looksSensitive(text);
  const artifactId = sha256Short(`${options.sourceLabel || ''}\n${options.task || options.goal || ''}\n${text}`);
  const outputDirResult = await ensureWritableDir(options.outputDir || 'reports/localqa/context-index');
  const outputDir = outputDirResult.dir;
  const artifactPath = path.join(outputDir, `${artifactId}.json`);
  const artifact = {
    artifactId,
    createdAt: new Date().toISOString(),
    sourceLabel: options.sourceLabel || null,
    task: options.task || options.goal || null,
    destinationKind,
    destinationUrl: destinationUrl || null,
    sensitivity,
    input: analysis.input,
    output: analysis.output,
    savings: analysis.savings,
    rawText: options.storeRaw === false ? null : text,
    outputDirFallback: outputDirResult.fallback,
  };

  const rawExternalSendAllowed = localDestination && !sensitivity.sensitive;
  const compactExternalSendAllowed = !sensitivity.sensitive || options.allowSensitiveCompact === true;
  const mustAskUserBeforeExternalRaw = externalDestination || sensitivity.sensitive;
  const { compactPayloadRedacted, compactPayload } = canonicalCompactPayload(analysis.output.compactText, sensitivity, destination);
  const recommendedAction = sensitivity.sensitive && !options.allowSensitiveCompact
    ? 'Do not send raw or compact evidence externally without user approval; use artifactPath locally or approve redacted compactPayload explicitly.'
    : externalDestination
      ? 'Send only compactPayload to external/main LLM, keep rawText in the local artifact.'
    : localDestination
      ? 'Local destination detected; prefer compactPayload unless raw evidence is explicitly needed.'
      : 'Use compactPayload by default and keep rawText local.';

  const policy = {
    mcpFirstRequired: true,
    localIndexCreated: true,
    destinationKind,
    destinationUrl: destinationUrl || null,
    localDestination,
    externalDestination,
    sensitive: sensitivity.sensitive,
    sensitivitySignals: sensitivity.signals,
    rawExternalSendAllowed,
    compactExternalSendAllowed,
    mustAskUserBeforeExternalRaw,
    compactPayloadRedacted,
    recommendedAction,
  };
  const handoffProof = buildHandoffProof({
    artifactId,
    compactPayload,
    policy,
    destination,
  });

  artifact.handoffProof = handoffProof;
  await fs.writeFile(artifactPath, JSON.stringify(artifact, null, 2));

  return {
    ok: true,
    tool: 'localqa_prepare_handoff',
    artifactId,
    artifactPath: path.resolve(artifactPath),
    policy,
    handoffProof,
    compactPayload,
    outputDirFallback: outputDirResult.fallback,
    analysis: {
      input: analysis.input,
      output: {
        chars: analysis.output.chars,
        approxTokens: analysis.output.approxTokens,
        budgetTokens: analysis.output.budgetTokens,
        sections: analysis.output.sections,
      },
      savings: analysis.savings,
      timings: analysis.timings,
    },
  };
}

export async function verifyLocalFirstHandoff(options = {}) {
  const artifactId = String(options.artifactId || '').trim();
  const artifactPathInput = String(options.artifactPath || '').trim();
  if (!artifactId && !artifactPathInput) {
    return {
      ok: false,
      verified: false,
      reason: 'artifactId or artifactPath is required',
    };
  }

  const artifactPath = artifactPathInput
    ? path.resolve(artifactPathInput)
    : path.resolve(options.outputDir || 'reports/localqa/context-index', `${artifactId}.json`);

  let artifact;
  try {
    artifact = JSON.parse(await fs.readFile(artifactPath, 'utf8'));
  } catch (err) {
    return {
      ok: false,
      verified: false,
      artifactPath,
      reason: `Unable to read artifact: ${err?.message || String(err)}`,
    };
  }

  const destination = normalizeDestination(options.destinationKind || artifact.destinationKind, options.destinationUrl || artifact.destinationUrl);
  const sensitivity = artifact.sensitivity || looksSensitive(String(artifact.rawText || ''));
  const compactText = String(artifact?.output?.compactText || '');
  const { compactPayload } = canonicalCompactPayload(compactText, sensitivity, destination);
  const compactPayloadSha256 = sha256Hex(compactPayload);
  const proof = artifact.handoffProof || null;

  const proofMatchesPayload = proof?.compactPayloadSha256
    ? proof.compactPayloadSha256 === compactPayloadSha256
    : false;
  const notExpired = proof?.expiresAt ? Date.now() <= Date.parse(proof.expiresAt) : false;
  const tokenMatches = proof?.token
    ? proof.token === sha256Hex([
      artifact.artifactId,
      compactPayloadSha256,
      proof.policyDigest,
      proof.issuedAt,
      proof.expiresAt,
    ].join('|'))
    : false;
  const destinationMatches = destination.destinationKind === (artifact.destinationKind || 'unknown');

  return {
    ok: true,
    tool: 'localqa_verify_handoff',
    verified: !!(proof && proofMatchesPayload && tokenMatches && notExpired && destinationMatches),
    artifactId: artifact.artifactId || artifactId || null,
    artifactPath,
    checks: {
      hasProof: !!proof,
      proofMatchesPayload,
      tokenMatches,
      notExpired,
      destinationMatches,
    },
    policy: {
      destinationKind: destination.destinationKind,
      destinationUrl: destination.destinationUrl || null,
      localDestination: destination.localDestination,
      externalDestination: destination.externalDestination,
      sensitive: !!sensitivity.sensitive,
    },
    compactPayload,
  };
}

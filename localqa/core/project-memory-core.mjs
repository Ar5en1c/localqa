import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { ensureWritableDir, redactSensitiveText } from './context-core.mjs';

function trimText(value, max = 1200) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function approxTokens(value) {
  return Math.ceil(String(value || '').length / 4);
}

function isoDay(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function shortHash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 16);
}

function defaultMemoryDir(options = {}) {
  return path.resolve(options.memoryDir || process.env.LOCALQA_MEMORY_DIR || '.localqa/memory');
}

function safeValue(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactSensitiveText(value);
  if (Array.isArray(value)) return value.map((item) => safeValue(item));
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, safeValue(item)]));
  }
  return value;
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (err) {
    if (err?.code === 'ENOENT') return fallback;
    throw err;
  }
}

function normalizeSteps(steps = []) {
  if (!Array.isArray(steps)) return [];
  return steps.slice(0, 20).map((step) => ({
    name: step?.name || step?.tool || step?.mode || 'step',
    ok: step?.ok !== false,
    durationMs: Number.isFinite(Number(step?.durationMs)) ? Number(step.durationMs) : undefined,
    error: step?.error ? trimText(step.error, 500) : undefined,
  }));
}

function summarizeResult(result = {}) {
  const inner = result?.result || result;
  const compact = inner?.output?.compactText || inner?.compactPayload || inner?.llmSummary?.sanitized || result?.compactText || '';
  const findings = Array.isArray(inner?.findings) ? inner.findings.slice(0, 8).map((item) => item?.message || item?.title || JSON.stringify(item)).join('; ') : '';
  return trimText(compact || findings || result?.summary || result?.task || '', 1400);
}

export async function appendProjectMemory(options = {}) {
  const memoryDirResult = await ensureWritableDir(defaultMemoryDir(options), 'localqa-project-memory');
  const memoryDir = memoryDirResult.dir;
  const day = options.date || isoDay();
  const file = path.join(memoryDir, `${day}.json`);
  const current = await readJson(file, {
    version: 'localqa.project_memory.v1',
    date: day,
    entries: [],
  });
  const createdAt = new Date().toISOString();
  const entry = {
    id: shortHash(`${createdAt}\n${options.kind || ''}\n${options.task || ''}\n${JSON.stringify(options.tokenSavings || {})}`),
    createdAt,
    kind: options.kind || 'local_agent_run',
    controlMode: options.controlMode || null,
    selectedMode: options.selectedMode || null,
    status: options.status || (options.ok === false ? 'failed' : 'completed'),
    task: trimText(redactSensitiveText(options.task || ''), 1200),
    summary: trimText(redactSensitiveText(options.summary || summarizeResult(options.result || {})), 1800),
    tokenSavings: safeValue(options.tokenSavings || null),
    artifactHandles: Array.isArray(options.artifactHandles) ? safeValue(options.artifactHandles.slice(0, 16)) : [],
    steps: normalizeSteps(options.steps),
    worked: Array.isArray(options.worked) ? safeValue(options.worked.slice(0, 12)) : [],
    failed: Array.isArray(options.failed) ? safeValue(options.failed.slice(0, 12)) : [],
    skipped: Array.isArray(options.skipped) ? safeValue(options.skipped.slice(0, 12)) : [],
    next: Array.isArray(options.next) ? safeValue(options.next.slice(0, 12)) : [],
    tags: Array.isArray(options.tags) ? safeValue(options.tags.slice(0, 20)) : [],
  };
  current.entries = Array.isArray(current.entries) ? current.entries : [];
  current.entries.push(entry);
  current.updatedAt = createdAt;
  await fs.writeFile(file, JSON.stringify(current, null, 2));
  await fs.writeFile(path.join(memoryDir, 'latest.json'), JSON.stringify({
    version: 'localqa.project_memory_latest.v1',
    updatedAt: createdAt,
    latestDay: day,
    latestFile: file,
    latestEntry: entry,
  }, null, 2));
  return {
    ok: true,
    memoryWritten: true,
    memoryDir,
    memoryPath: file,
    entryId: entry.id,
    outputDirFallback: memoryDirResult.fallback,
  };
}

async function collectMemoryEntries(options = {}) {
  const memoryDir = defaultMemoryDir(options);
  let files = [];
  try {
    files = await fs.readdir(memoryDir);
  } catch (err) {
    if (err?.code === 'ENOENT') return { memoryDir, entries: [] };
    throw err;
  }
  const jsonFiles = files
    .filter((file) => /^\d{4}-\d{2}-\d{2}\.json$/.test(file))
    .sort()
    .reverse()
    .slice(0, Number.parseInt(options.maxDays, 10) || 30);
  const entries = [];
  for (const file of jsonFiles) {
    const payload = await readJson(path.join(memoryDir, file), null);
    for (const entry of payload?.entries || []) entries.push({ ...entry, memoryFile: path.join(memoryDir, file) });
  }
  return { memoryDir, entries };
}

function queryTerms(question) {
  return String(question || '')
    .toLowerCase()
    .split(/[^a-z0-9_./:-]+/)
    .filter((term) => term.length > 2)
    .slice(0, 40);
}

function scoreEntry(entry, terms) {
  const haystack = [
    entry.task,
    entry.summary,
    entry.kind,
    entry.controlMode,
    entry.selectedMode,
    ...(entry.tags || []),
    ...(entry.worked || []),
    ...(entry.failed || []),
    ...(entry.skipped || []),
    ...(entry.next || []),
  ].join('\n').toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (haystack.includes(term)) score += 3;
  }
  if (entry.status === 'failed') score += 1;
  if (entry.tokenSavings?.savedApproxTokens) score += 1;
  const ageMs = Date.now() - Date.parse(entry.createdAt || 0);
  if (Number.isFinite(ageMs) && ageMs < 3 * 24 * 60 * 60 * 1000) score += 1;
  return score;
}

export async function queryProjectMemory(options = {}) {
  const question = trimText(options.question || options.task || options.query || 'What has been done recently?', 800);
  const maxEntries = Math.max(1, Math.min(Number.parseInt(options.maxEntries, 10) || 12, 50));
  const { memoryDir, entries } = await collectMemoryEntries(options);
  const terms = queryTerms(question);
  const ranked = entries
    .map((entry) => ({ ...entry, score: scoreEntry(entry, terms) }))
    .filter((entry) => entry.score > 0 || !terms.length)
    .sort((a, b) => b.score - a.score || String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .slice(0, maxEntries);
  const lines = ranked.flatMap((entry, index) => [
    `${index + 1}. ${entry.createdAt || 'unknown'} | ${entry.kind || 'memory'} | ${entry.status || 'unknown'} | ${entry.selectedMode || entry.controlMode || 'n/a'}`,
    `   task: ${trimText(entry.task, 280)}`,
    entry.summary ? `   summary: ${trimText(entry.summary, 420)}` : '',
    entry.tokenSavings ? `   tokens: raw=${entry.tokenSavings.rawEvidenceApproxTokens ?? 'n/a'} compact=${entry.tokenSavings.compactReportApproxTokens ?? 'n/a'} saved=${entry.tokenSavings.savedApproxTokens ?? 'n/a'} reduction=${entry.tokenSavings.reductionRatio ?? 'n/a'}%` : '',
    entry.next?.length ? `   next: ${entry.next.map((item) => trimText(item, 120)).join('; ')}` : '',
  ].filter(Boolean));
  const compactText = [
    `Project memory query: ${question}`,
    `Memory dir: ${memoryDir}`,
    `Matched entries: ${ranked.length}/${entries.length}`,
    '',
    ...lines,
  ].join('\n');
  return {
    ok: true,
    tool: 'localqa_project_memory_query',
    memoryDir,
    question,
    matchedEntries: ranked.length,
    totalEntries: entries.length,
    entries: ranked.map((entry) => safeValue({
      id: entry.id,
      createdAt: entry.createdAt,
      kind: entry.kind,
      status: entry.status,
      selectedMode: entry.selectedMode,
      task: entry.task,
      summary: entry.summary,
      tokenSavings: entry.tokenSavings,
      next: entry.next,
      tags: entry.tags,
    })),
    compactText,
    tokenSavings: {
      rawEvidenceApproxTokens: entries.length ? entries.reduce((sum, entry) => sum + approxTokens(JSON.stringify(entry)), 0) : 0,
      compactReportApproxTokens: approxTokens(compactText),
      savedApproxTokens: Math.max(0, (entries.length ? entries.reduce((sum, entry) => sum + approxTokens(JSON.stringify(entry)), 0) : 0) - approxTokens(compactText)),
      reductionRatio: entries.length ? Math.max(0, +((1 - approxTokens(compactText) / entries.reduce((sum, entry) => sum + approxTokens(JSON.stringify(entry)), 0)) * 100).toFixed(2)) : 0,
    },
  };
}

export async function recordWorkMemory(options = {}) {
  const task = options.task || options.whatChanged || 'Record LocalQA work memory.';
  const summary = [
    options.summary || '',
    options.whatChanged ? `Changed: ${options.whatChanged}` : '',
    options.testsRun ? `Tests: ${options.testsRun}` : '',
    options.result ? `Result: ${options.result}` : '',
  ].filter(Boolean).join('\n');
  const write = await appendProjectMemory({
    ...options,
    kind: options.kind || 'work_record',
    task,
    summary,
    status: options.status || 'recorded',
  });
  return {
    ok: true,
    tool: 'localqa_project_memory_record',
    ...write,
  };
}

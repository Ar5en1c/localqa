#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { runLocalAgentTask } from '../localqa/core/local-agent-core.mjs';
import { ensureWritableDir, redactSensitiveText } from '../localqa/core/context-core.mjs';

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

async function readInput() {
  const idx = process.argv.indexOf('--input-file');
  const file = idx >= 0 ? process.argv[idx + 1] : '';
  if (file) return fs.readFile(path.resolve(file), 'utf8');
  return readStdin();
}

function parseJson(text) {
  const raw = String(text || '').trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

function defaultLlmFromEnv() {
  const defaultToBonsai = String(process.env.LOCALQA_DEFAULT_LLM || '').toLowerCase() === 'bonsai' ||
    String(process.env.LOCALQA_OPENCODE_DEFAULT_LLM || '').toLowerCase() === 'bonsai';
  const model = process.env.LOCALQA_LLM_MODEL || (defaultToBonsai ? 'Bonsai-8B.gguf' : '');
  if (!model) return null;
  return {
    enabled: true,
    provider: process.env.LOCALQA_LLM_PROVIDER || 'openai-compatible',
    model,
    endpoint: process.env.LOCALQA_LLM_ENDPOINT || 'http://127.0.0.1:18081/v1/chat/completions',
    timeoutMs: Number.parseInt(process.env.LOCALQA_LLM_TIMEOUT_MS, 10) || 60000,
    maxTokens: Number.parseInt(process.env.LOCALQA_LLM_MAX_TOKENS, 10) || 256,
    temperature: Number.isFinite(Number(process.env.LOCALQA_LLM_TEMPERATURE)) ? Number(process.env.LOCALQA_LLM_TEMPERATURE) : 0.5,
    topK: Number.isFinite(Number(process.env.LOCALQA_LLM_TOP_K)) ? Number(process.env.LOCALQA_LLM_TOP_K) : 20,
    topP: Number.isFinite(Number(process.env.LOCALQA_LLM_TOP_P)) ? Number(process.env.LOCALQA_LLM_TOP_P) : 0.85,
  };
}

function redactForOpenCode(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactSensitiveText(value);
  if (Array.isArray(value)) return value.map((item) => redactForOpenCode(item));
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactForOpenCode(item)]));
  }
  return value;
}

function summarizeForOpenCode(result) {
  const inner = result?.result || {};
  const memory = result?.memory || inner?.memory || (inner?.memoryWritten || inner?.memoryPath || inner?.entryId
    ? {
        memoryWritten: inner?.memoryWritten,
        memoryDir: inner?.memoryDir,
        memoryPath: inner?.memoryPath,
        entryId: inner?.entryId,
        outputDirFallback: inner?.outputDirFallback,
      }
    : undefined);
  const handle = result?.handoff?.artifactId || inner?.artifactId
    ? `vault://${result?.handoff?.artifactId || inner?.artifactId}`
    : null;
  return {
    ok: result?.ok !== false,
    tool: 'local_agent_run',
    controlMode: result?.controlMode || null,
    selectedMode: result?.selectedMode || null,
    task: redactForOpenCode(result?.task || null),
    handle,
    artifactPath: result?.handoff?.artifactPath || inner?.artifactPath || inner?.reportPath || null,
    tokenSavings: result?.tokenSavings || inner?.tokenSavings || null,
    enforcement: result?.enforcement || null,
    policy: result?.policy || inner?.policy || null,
    steps: result?.steps || [],
    memory: redactForOpenCode(memory),
    telemetry: result?.telemetry || null,
    findings: Array.isArray(inner?.findings) ? redactForOpenCode(inner.findings.slice(0, 20)) : undefined,
    findingCount: inner?.findingCount ?? (Array.isArray(inner?.findings) ? inner.findings.length : undefined),
    llmSummary: redactForOpenCode(inner?.llmSummary?.sanitized || inner?.llmSummary || undefined),
    compactText: redactForOpenCode(inner?.compactText || inner?.output?.compactText || inner?.analysis?.output?.compactText || result?.analysis?.output?.compactText || undefined),
    compactPayload: redactForOpenCode(inner?.compactPayload || result?.handoff?.compactPayload || undefined),
  };
}

try {
  const input = parseJson(await readInput());
  const outputDirResult = await ensureWritableDir(
    input.outputDir || process.env.LOCALQA_OPENCODE_OUTPUT_DIR || path.resolve('.opencode/vault-runs'),
    'localqa-opencode-vault-runs'
  );
  const outputDir = outputDirResult.dir;
  const result = await runLocalAgentTask({
    ...input,
    outputDir,
    task: input.task || input.goal || input.query || 'Run the requested LocalQA task.',
    llm: input.llm || defaultLlmFromEnv(),
  });
  console.log(JSON.stringify({
    ...summarizeForOpenCode(result),
    outputDirFallback: result?.outputDirFallback || result?.result?.outputDirFallback || outputDirResult.fallback || undefined,
  }, null, 2));
} catch (err) {
  console.log(JSON.stringify({
    ok: false,
    tool: 'local_agent_run',
    error: err?.message || String(err),
    stack: String(err?.stack || '').split('\n').slice(0, 6).join('\n'),
  }, null, 2));
  process.exitCode = 1;
}

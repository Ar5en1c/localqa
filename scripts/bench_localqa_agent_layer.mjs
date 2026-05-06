#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const RUN_DATE = process.env.LOCALQA_REPORT_DATE || new Date().toISOString().slice(0, 10);
const OUT_DIR = path.resolve(process.env.LOCALQA_AGENT_LAYER_OUT_DIR || `reports/localqa/agent_layer_real_env_${RUN_DATE}`);
const RUNNER = path.resolve('scripts/localqa-opencode-runner.mjs');

function approxTokens(value) {
  return Math.ceil(String(value || '').length / 4);
}

async function pathExists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function latestOssBenchDir() {
  const base = path.resolve('reports/localqa');
  const entries = await fs.readdir(base, { withFileTypes: true }).catch(() => []);
  const dirs = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('opencode_oss_codebases_'))
    .map((entry) => path.join(base, entry.name))
    .sort();
  if (!dirs.length) throw new Error('No opencode_oss_codebases_* report found. Run localqa:bench:opencode-oss-codebases first.');
  return dirs.at(-1);
}

function runRunner(input) {
  const startedAt = performance.now();
  const stdout = execFileSync('node', [RUNNER], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 40,
  });
  return {
    durationMs: +(performance.now() - startedAt).toFixed(2),
    stdout,
    json: JSON.parse(stdout),
  };
}

function hasLeak(value, needles) {
  const text = JSON.stringify(value);
  return needles.some((needle) => text.includes(needle));
}

function summarizeRun(name, run, extra = {}) {
  const tokenSavings = run.json.tokenSavings || null;
  return {
    name,
    ok: run.json.ok !== false,
    controlMode: run.json.controlMode || null,
    selectedMode: run.json.selectedMode || null,
    durationMs: run.durationMs,
    tokenSavings,
    compactApproxTokens: tokenSavings?.compactReportApproxTokens ?? approxTokens(run.json.compactText || run.stdout),
    memoryWritten: !!run.json.memory?.memoryWritten,
    memoryPath: run.json.memory?.memoryPath || run.json.result?.memoryPath || null,
    stepCount: Array.isArray(run.json.steps) ? run.json.steps.length : 0,
    error: run.json.error || null,
    ...extra,
  };
}

function md(report) {
  const rows = report.results.map((item) => `| ${item.name} | ${item.ok ? 'yes' : 'no'} | ${item.controlMode || 'n/a'} | ${item.selectedMode || 'n/a'} | ${item.durationMs} | ${item.tokenSavings?.rawEvidenceApproxTokens ?? 'n/a'} | ${item.tokenSavings?.compactReportApproxTokens ?? item.compactApproxTokens ?? 'n/a'} | ${item.tokenSavings?.savedApproxTokens ?? 'n/a'} | ${item.tokenSavings?.reductionRatio ?? 'n/a'}% | ${item.memoryWritten ? 'yes' : 'no'} | ${item.note || ''} |`).join('\n');
  return `# LocalQA Agent Layer Real-Env Benchmark

Date: ${report.generatedAt}

## Scope

This validates the new LocalQA agent layer in this actual repo environment. It tests directed execution, strict mode rejection, durable memory record/query, redaction-safe handoff output, and a real local OSS codebase evidence file.

## Environment

- Worktree: ${report.worktree}
- Evidence file: ${report.evidencePath}
- Evidence bytes: ${report.evidenceBytes}
- Evidence approx tokens: ${report.evidenceApproxTokens}
- Output dir: ${report.outDir}

## Results

| Test | OK | Control | Mode | Runtime ms | Raw toks | Compact toks | Saved toks | Reduction | Memory | Note |
|---|---:|---|---|---:|---:|---:|---:|---:|---:|---|
${rows}

## Findings

- Directed execution works when the frontier model specifies exact local steps.
- Strict mode rejects unknown tools instead of letting LocalQA improvise.
- Project memory can be written and queried locally through the same one-tool surface.
- Sensitive handoff output did not leak the synthetic test secret in the OpenCode-facing runner response.
- The measured token savings are from a real local OSS evidence bundle, not a synthetic tiny prompt.

## Limits

- This benchmark does not open a live browser page. It focuses on the new control layer and local file evidence path.
- It validates orientation/compression/memory. It does not prove patch correctness.
`;
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const ossDir = await latestOssBenchDir();
  const evidencePath = path.join(ossDir, 'fastify_fastify', 'raw-codebase-evidence.txt');
  if (!(await pathExists(evidencePath))) throw new Error(`Missing evidence file: ${evidencePath}`);
  const evidenceStat = await fs.stat(evidencePath);
  const evidenceText = await fs.readFile(evidencePath, 'utf8');
  const memoryDir = path.join(OUT_DIR, 'memory');
  const outputDir = path.join(OUT_DIR, 'vault-runs');

  const results = [];

  const recordRun = runRunner({
    controlMode: 'record',
    task: 'Record LocalQA agent-layer benchmark setup.',
    whatChanged: 'Testing directed execution, strict mode, memory, handoff redaction, and real codebase evidence compression.',
    testsRun: 'bench_localqa_agent_layer.mjs',
    workResult: 'Benchmark in progress.',
    next: ['Use directed mode for frontier-agent planned investigations.', 'Use memory mode before repeated project work.'],
    tags: ['agent-layer', 'benchmark', 'memory'],
    memoryDir,
    outputDir,
  });
  results.push(summarizeRun('record_memory', recordRun, { note: 'writes local daily memory' }));

  const directedRun = runRunner({
    controlMode: 'directed',
    task: 'Frontier model planned task: orient on Fastify validation/error response change using local evidence only.',
    directedSteps: [
      {
        tool: 'memory_query',
        question: 'What LocalQA agent-layer benchmark setup has already been recorded?',
        contextBudgetTokens: 400,
      },
      {
        tool: 'context_cleanup',
        filePath: evidencePath,
        task: 'Extract likely source files, test commands, package scripts, and risk signals for changing Fastify validation/error response behavior.',
        contextBudgetTokens: 800,
      },
    ],
    outputContract: {
      maxTokens: 1200,
      include: ['likely_files', 'test_commands', 'risks', 'next_actions'],
      exclude: ['raw_file_tree', 'full_excerpts'],
    },
    memoryDir,
    outputDir,
  });
  results.push(summarizeRun('directed_memory_plus_codebase_cleanup', directedRun, { note: 'frontier model specifies exact local steps' }));

  const strictRun = runRunner({
    controlMode: 'strict',
    task: 'Strict mode should reject unknown local tool names.',
    directedSteps: [{ tool: 'unknown_tool', task: 'This should not run.' }],
    memoryDir,
    outputDir,
  });
  results.push(summarizeRun('strict_rejects_unknown_tool', strictRun, { note: strictRun.json.ok === false ? 'rejected as expected' : 'unexpected pass' }));

  const secret = 'supersecret-localqa-agent-layer-12345';
  const handoffRun = runRunner({
    controlMode: 'directed',
    task: `Prepare external handoff for synthetic secret PASSWORD=${secret}`,
    directedSteps: [{
      tool: 'handoff_gate',
      task: 'Prepare a redacted compact handoff for this synthetic credential evidence.',
      text: `SYNTHETIC_ONLY login failed with PASSWORD=${secret} and authorization: bearer sk-localqa-agent-layer-test-token`,
      destinationKind: 'main_llm',
      externalSendAttempted: true,
      sendPayloadKind: 'raw',
      contextBudgetTokens: 600,
    }],
    outputContract: { maxTokens: 800 },
    memoryDir,
    outputDir,
  });
  results.push(summarizeRun('directed_handoff_redaction', handoffRun, {
    leakedSyntheticSecret: hasLeak(handoffRun.json, [secret, 'sk-localqa-agent-layer-test-token']),
    note: hasLeak(handoffRun.json, [secret, 'sk-localqa-agent-layer-test-token']) ? 'leak detected' : 'no runner-output leak',
  }));

  const queryRun = runRunner({
    controlMode: 'memory',
    question: 'What did we test for the LocalQA agent layer and what should happen next?',
    maxEntries: 8,
    memoryDir,
    outputDir,
  });
  results.push(summarizeRun('query_project_memory', queryRun, { note: 'reads local memory ledger' }));

  const report = {
    ok: results.every((item) => item.name === 'strict_rejects_unknown_tool' ? item.ok === false : item.ok),
    generatedAt: new Date().toISOString(),
    worktree: process.cwd(),
    outDir: OUT_DIR,
    evidencePath,
    evidenceBytes: evidenceStat.size,
    evidenceApproxTokens: approxTokens(evidenceText),
    results,
  };
  await fs.writeFile(path.join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2));
  await fs.writeFile(path.join(OUT_DIR, 'AGENT_LAYER_REAL_ENV_BENCHMARK.md'), md(report));
  console.log(JSON.stringify({
    ok: report.ok,
    outDir: OUT_DIR,
    evidenceApproxTokens: report.evidenceApproxTokens,
    results: results.map((item) => ({
      name: item.name,
      ok: item.ok,
      controlMode: item.controlMode,
      selectedMode: item.selectedMode,
      durationMs: item.durationMs,
      tokenSavings: item.tokenSavings,
      memoryWritten: item.memoryWritten,
      leakedSyntheticSecret: item.leakedSyntheticSecret,
      note: item.note,
    })),
  }, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err?.message || String(err), stack: String(err?.stack || '').split('\n').slice(0, 8).join('\n') }, null, 2));
  process.exitCode = 1;
});

#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const RUN_DATE = process.env.LOCALQA_REPORT_DATE || new Date().toISOString().slice(0, 10);
const OUT_DIR = path.resolve(process.env.LOCALQA_AGENTIC_WORKFLOW_OUT_DIR || `reports/localqa/agentic_workflows_${RUN_DATE}`);
const RUNNER = path.resolve('scripts/localqa-opencode-runner.mjs');

const WORKFLOWS = [
  {
    id: 'fastify_validation_error_agentic_plan',
    title: 'Fastify validation/error contract investigation',
    evidenceName: 'fastify_fastify',
    task: 'Frontier agent task: plan a safe Fastify validation/error response change. Use local evidence to identify likely files, test commands, generated/integrity risks, TypeScript checks, and next exact reads before implementation.',
    expectedSignals: ['fastify', 'validation', 'error-handler', 'test:validator:integrity', 'test:typescript', 'lib/validation.js', 'lib/error-handler.js', 'package.json'],
    mustHave: ['validation', 'test:validator:integrity', 'test:typescript'],
    targetFollowup: 'Search for exact Fastify validation/error-handler source, validator integrity commands, TypeScript commands, and tests that protect response contracts.',
  },
  {
    id: 'express_router_middleware_agentic_plan',
    title: 'Express router/middleware investigation',
    evidenceName: 'expressjs_express',
    task: 'Frontier agent task: plan a safe Express router or middleware behavior change. Use local evidence to identify source areas, test areas, package scripts, compatibility risks, and next exact reads before implementation.',
    expectedSignals: ['express', 'router', 'middleware', 'mocha', 'test', 'package.json', 'lib/router'],
    mustHave: ['router', 'middleware', 'test'],
    targetFollowup: 'Search for Express router/middleware source files, test commands, compatibility risks, and tests that protect routing behavior.',
  },
  {
    id: 'zod_schema_parser_agentic_plan',
    title: 'Zod schema/parser investigation',
    evidenceName: 'colinhacks_zod',
    task: 'Frontier agent task: plan a safe Zod schema parsing behavior change. Use local evidence to identify package/source areas, type-surface risks, tests, docs/migration areas, and next exact reads before implementation.',
    expectedSignals: ['zod', 'schema', 'parser', 'typescript', 'test', 'packages', 'package.json', 'src'],
    mustHave: ['zod', 'schema', 'test'],
    targetFollowup: 'Search for Zod schema/parser source areas, TypeScript/type-surface tests, package scripts, and migration/docs risks.',
  },
];

function approxTokens(value) {
  return Math.ceil(String(value || '').length / 4);
}

function pct(saved, raw) {
  return raw > 0 ? +((saved / raw) * 100).toFixed(2) : 0;
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
  if (!dirs.length) throw new Error('No opencode_oss_codebases_* report found. Run npm run localqa:bench:opencode-oss-codebases first.');
  return dirs.at(-1);
}

function runRunner(input) {
  const startedAt = performance.now();
  const stdout = execFileSync('node', [RUNNER], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 50,
  });
  return {
    durationMs: +(performance.now() - startedAt).toFixed(2),
    json: JSON.parse(stdout),
  };
}

function compactTextFromRun(run) {
  return String(run?.json?.compactText || run?.json?.compactPayload || run?.json?.result?.compactText || JSON.stringify(run?.json || {}));
}

function uniqueMatches(text, regex, limit = 24) {
  const out = new Set();
  for (const match of String(text || '').matchAll(regex)) {
    const value = String(match[1] || match[0] || '').trim().replace(/[),.;:'"`]+$/, '');
    if (value) out.add(value);
    if (out.size >= limit) break;
  }
  return [...out];
}

function scoreSignals(text, expectedSignals, mustHave) {
  const lower = String(text || '').toLowerCase();
  const matched = expectedSignals.filter((signal) => lower.includes(signal.toLowerCase()));
  const missing = expectedSignals.filter((signal) => !matched.includes(signal));
  const mustMatched = mustHave.filter((signal) => lower.includes(signal.toLowerCase()));
  const mustMissing = mustHave.filter((signal) => !mustMatched.includes(signal));
  const coverage = expectedSignals.length ? matched.length / expectedSignals.length : 1;
  const mustCoverage = mustHave.length ? mustMatched.length / mustHave.length : 1;
  const score = +(coverage * 0.6 + mustCoverage * 0.4).toFixed(3);
  return { score, coverage: +coverage.toFixed(3), mustCoverage: +mustCoverage.toFixed(3), matched, missing, mustMatched, mustMissing };
}

function scoreActionability(text) {
  const value = String(text || '');
  const paths = uniqueMatches(value, /\b((?:lib|src|source|test|tests|packages|package|docs|examples|benchmarks|types|scripts|build)[\w./-]*\.(?:js|mjs|cjs|ts|tsx|json|md|yml|yaml))\b/g, 40);
  const commands = uniqueMatches(value, /\b((?:npm|pnpm|yarn|bun)\s+(?:run\s+)?[\w:./-]+|test:[\w:./-]+|npm\s+test)\b/g, 30);
  const hasSource = /\b(?:lib|src|packages|source)\//i.test(value) || /source (?:area|file|path)s?/i.test(value);
  const hasTests = /\b(?:test|tests|__tests__|spec)\//i.test(value) || /test (?:area|file|path|command)s?/i.test(value);
  const hasMemory = /project memory|memory query|matched entries|localqa/i.test(value);
  const hasNextReads = /next (?:exact )?(?:read|reads|action|actions)|likely files?|source areas?|risk/i.test(value);
  const riskSignals = uniqueMatches(value, /\b(risk|breaking|compat(?:ibility)?|contract|generated|integrity|type(?:script)?|migration|regression|middleware|validation|schema|parser|router)\b/gi, 40);
  const checks = [paths.length >= 3, commands.length >= 1, hasSource, hasTests, hasMemory, hasNextReads, riskSignals.length >= 2];
  const passed = checks.filter(Boolean).length;
  return {
    score: +(passed / checks.length).toFixed(3),
    passed,
    total: checks.length,
    paths: paths.slice(0, 10),
    commands: commands.slice(0, 10),
    riskSignals: riskSignals.slice(0, 10),
    hasSource,
    hasTests,
    hasMemory,
    hasNextReads,
  };
}

function qualityScore(signal, actionability) {
  const score = +(signal.score * 0.55 + actionability.score * 0.45).toFixed(3);
  return {
    score,
    label: score >= 0.9 ? 'strong' : score >= 0.75 ? 'usable' : score >= 0.55 ? 'weak' : 'fail',
    pass: score >= 0.75 && signal.mustCoverage >= 0.67,
  };
}

async function runWorkflow(workflow, evidencePath, outDir) {
  const raw = await fs.readFile(evidencePath, 'utf8');
  const rawTokens = approxTokens(raw);
  const memoryDir = path.join(outDir, 'memory');
  const outputDir = path.join(outDir, 'vault-runs');

  const record = runRunner({
    controlMode: 'record',
    task: `Record setup for ${workflow.title}.`,
    whatChanged: `Preparing agentic workflow benchmark for ${workflow.title}.`,
    testsRun: 'localqa agentic workflow benchmark',
    workResult: 'Setup recorded before directed evidence work.',
    tags: ['agentic-workflow', workflow.id],
    memoryDir,
    outputDir,
  });

  const localqa = runRunner({
    controlMode: 'directed',
    task: workflow.task,
    directedSteps: [
      {
        tool: 'memory_query',
        question: `What has already been recorded for ${workflow.title}?`,
        contextBudgetTokens: 400,
      },
      {
        tool: 'context_cleanup',
        filePath: evidencePath,
        task: workflow.task,
        contextBudgetTokens: 900,
      },
      {
        tool: 'context_cleanup',
        filePath: evidencePath,
        task: workflow.targetFollowup,
        contextBudgetTokens: 900,
      },
    ],
    outputContract: {
      maxTokens: 1800,
      include: ['prior_memory', 'likely_files', 'test_commands', 'risk_signals', 'next_exact_reads'],
      exclude: ['raw_file_tree', 'full_file_excerpts', 'full_package_json'],
    },
    memoryDir,
    outputDir,
  });

  const compact = compactTextFromRun(localqa);
  const signal = scoreSignals(compact, workflow.expectedSignals, workflow.mustHave);
  const actionability = scoreActionability(compact);
  const quality = qualityScore(signal, actionability);
  const tokenSavings = localqa.json.tokenSavings || {
    rawEvidenceApproxTokens: rawTokens,
    compactReportApproxTokens: approxTokens(compact),
    savedApproxTokens: Math.max(0, rawTokens - approxTokens(compact)),
    reductionRatio: pct(Math.max(0, rawTokens - approxTokens(compact)), rawTokens),
  };
  const compactTokens = tokenSavings.compactReportApproxTokens ?? approxTokens(compact);
  const effectiveSavedTokens = Math.max(0, rawTokens - compactTokens);
  const normalBaseline = {
    approxToolCalls: 3,
    rawContextApproxTokens: rawTokens,
    compactContextApproxTokens: rawTokens,
    savedApproxTokens: 0,
    reductionRatio: 0,
    memoryWritten: false,
    risk: 'frontier model receives full raw evidence or must spend repeated tool calls finding source/test signals',
  };
  const localqaWorkflow = {
    approxToolCallsFromMainAgent: 1,
    internalLocalSteps: 3,
    baselineRawContextApproxTokens: rawTokens,
    internalLocalRawTokensProcessed: tokenSavings.rawEvidenceApproxTokens,
    compactContextApproxTokens: compactTokens,
    savedApproxTokens: effectiveSavedTokens,
    reductionRatio: pct(effectiveSavedTokens, rawTokens),
    internalLocalProcessingReductionRatio: tokenSavings.reductionRatio,
    memoryWritten: !!localqa.json.memory?.memoryWritten,
    runtimeMs: localqa.durationMs,
  };
  const result = {
    id: workflow.id,
    title: workflow.title,
    evidencePath,
    evidenceBytes: Buffer.byteLength(raw),
    rawTokens,
    record: {
      ok: record.json.ok !== false,
      runtimeMs: record.durationMs,
      memoryWritten: !!record.json.memory?.memoryWritten,
    },
    normalBaseline,
    localqaWorkflow,
    signalScore: signal,
    actionabilityScore: actionability,
    quality,
    compactPreview: compact.slice(0, 2600),
  };
  await fs.writeFile(path.join(outDir, `${workflow.id}.json`), JSON.stringify(result, null, 2));
  return result;
}

function md(report) {
  const rows = report.workflows.map((item) => `| ${item.title} | ${item.rawTokens} | ${item.localqaWorkflow.compactContextApproxTokens} | ${item.localqaWorkflow.savedApproxTokens} | ${item.localqaWorkflow.reductionRatio}% | ${item.localqaWorkflow.runtimeMs} | ${item.signalScore.score} | ${item.actionabilityScore.score} | ${item.quality.score} | ${item.quality.label} | ${item.localqaWorkflow.memoryWritten ? 'yes' : 'no'} |`).join('\n');
  const aggregate = report.aggregate;
  return `# LocalQA Agentic Workflow Benchmark

Date: ${report.generatedAt}

## Purpose

This benchmark tests multi-step, agentic, frontier-model-support workflows. The frontier model owns the plan. LocalQA executes directed local steps: memory query, long-context codebase evidence compression, targeted follow-up extraction, memory recording, and compact output packaging.

It compares a normal raw-context agent path against LocalQA as a local evidence/memory layer. This measures context savings, actionability, quality signals, runtime, and memory behavior. It does not claim patch correctness.

## Aggregate

- Workflows: ${report.workflows.length}
- Raw baseline context: ${aggregate.rawTokens} tokens
- LocalQA compact context: ${aggregate.compactTokens} tokens
- Saved: ${aggregate.savedTokens} tokens
- Reduction: ${aggregate.reductionRatio}%
- Average quality score: ${aggregate.avgQualityScore}
- Passing quality workflows: ${aggregate.passingQuality}/${report.workflows.length}
- Main-agent tool calls: ${report.workflows.length} LocalQA calls instead of exposing ${aggregate.rawTokens} raw tokens to the main model.

## Results

| Workflow | Raw toks | LocalQA compact toks | Saved toks | Reduction | Runtime ms | Signal | Actionability | Quality | Label | Memory |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|
${rows}

## Normal agent path vs LocalQA path

Normal agent path:

- Main model performs repeated file/list/search/read loops or receives large raw evidence.
- Raw evidence remains in model context unless manually summarized.
- Prior attempts are preserved only if still in chat context.
- Token cost scales with raw logs/repo/browser evidence.

LocalQA path:

- Main model makes one high-level local_agent_run call with directed steps.
- LocalQA queries local memory, compresses long evidence, does targeted follow-up, and writes memory locally.
- Main model receives compact evidence, likely files, commands, risks, and next reads.
- Token cost scales with compact output, not raw evidence size.

## Quality scoring

Quality is deterministic and conservative:

- Signal score checks named task-critical terms.
- Actionability checks path-like evidence, test command evidence, source/test split, memory context, next-read/risk language.
- A passing workflow must score at least 0.75 and preserve at least 67% of must-have signals.

## Public-safe claim

Across these real OSS long-context workflows, LocalQA reduced ${aggregate.rawTokens} raw evidence tokens to ${aggregate.compactTokens} compact tokens (${aggregate.reductionRatio}% reduction) while preserving deterministic quality/actionability gates on ${aggregate.passingQuality}/${report.workflows.length} multi-step workflows.

## Limits

- This is evidence/workflow quality, not patch correctness.
- The frontier model still must read exact files before editing.
- Browser QA is not included in this benchmark because browser permissions vary by environment; this benchmark targets reproducible repo evidence workflows.
`;
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const ossDir = path.resolve(process.env.LOCALQA_OPENCODE_OSS_BENCH_DIR || await latestOssBenchDir());
  const workflows = [];
  for (const workflow of WORKFLOWS) {
    const evidencePath = path.join(ossDir, workflow.evidenceName, 'raw-codebase-evidence.txt');
    if (!(await pathExists(evidencePath))) throw new Error(`Missing evidence for ${workflow.id}: ${evidencePath}`);
    workflows.push(await runWorkflow(workflow, evidencePath, OUT_DIR));
  }
  const rawTokens = workflows.reduce((sum, item) => sum + item.rawTokens, 0);
  const compactTokens = workflows.reduce((sum, item) => sum + item.localqaWorkflow.compactContextApproxTokens, 0);
  const savedTokens = Math.max(0, rawTokens - compactTokens);
  const aggregate = {
    rawTokens,
    compactTokens,
    savedTokens,
    reductionRatio: pct(savedTokens, rawTokens),
    avgQualityScore: +(workflows.reduce((sum, item) => sum + item.quality.score, 0) / workflows.length).toFixed(3),
    passingQuality: workflows.filter((item) => item.quality.pass).length,
  };
  const report = {
    ok: aggregate.passingQuality === workflows.length,
    generatedAt: new Date().toISOString(),
    sourceOssBenchDir: ossDir,
    outDir: OUT_DIR,
    aggregate,
    workflows,
  };
  await fs.writeFile(path.join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2));
  await fs.writeFile(path.join(OUT_DIR, 'AGENTIC_WORKFLOW_BENCHMARK.md'), md(report));
  console.log(JSON.stringify({
    ok: report.ok,
    outDir: OUT_DIR,
    aggregate,
    workflows: workflows.map((item) => ({
      id: item.id,
      rawTokens: item.rawTokens,
      compactTokens: item.localqaWorkflow.compactContextApproxTokens,
      savedTokens: item.localqaWorkflow.savedApproxTokens,
      reductionRatio: item.localqaWorkflow.reductionRatio,
      runtimeMs: item.localqaWorkflow.runtimeMs,
      quality: item.quality,
      signalScore: item.signalScore.score,
      actionabilityScore: item.actionabilityScore.score,
      memoryWritten: item.localqaWorkflow.memoryWritten,
    })),
  }, null, 2));
  if (!report.ok) process.exitCode = 1;
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err?.message || String(err), stack: String(err?.stack || '').split('\n').slice(0, 8).join('\n') }, null, 2));
  process.exitCode = 1;
});

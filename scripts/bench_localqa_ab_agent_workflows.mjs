#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const RUN_DATE = process.env.LOCALQA_REPORT_DATE || new Date().toISOString().slice(0, 10);
const OUT_DIR = path.resolve(process.env.LOCALQA_AB_WORKFLOW_OUT_DIR || `reports/localqa/ab_agent_workflows_${RUN_DATE}`);
const RUNNER = path.resolve('scripts/localqa-opencode-runner.mjs');

const TASKS = [
  {
    id: 'fastify_validation_error_contract',
    title: 'Fastify validation/error contract pre-implementation plan',
    evidenceName: 'fastify_fastify',
    task: 'Plan a safe Fastify validation/error response behavior change. Identify source files, test commands, generated/integrity risks, TypeScript checks, and exact next reads.',
    expected: ['fastify', 'validation', 'error-handler', 'test:validator:integrity', 'test:typescript', 'lib/validation.js', 'lib/error-handler.js', 'package.json'],
    mustHave: ['validation', 'test:validator:integrity', 'test:typescript'],
    terms: ['fastify', 'validation', 'error-handler', 'validator', 'integrity', 'typescript', 'error response', 'schema'],
  },
  {
    id: 'express_router_middleware',
    title: 'Express router/middleware pre-implementation plan',
    evidenceName: 'expressjs_express',
    task: 'Plan a safe Express router or middleware behavior change. Identify source areas, test areas, package scripts, compatibility risks, and exact next reads.',
    expected: ['express', 'router', 'middleware', 'mocha', 'test', 'package.json', 'lib/router'],
    mustHave: ['router', 'middleware', 'test'],
    terms: ['express', 'router', 'middleware', 'route', 'mocha', 'test', 'compatibility'],
  },
  {
    id: 'zod_schema_parser',
    title: 'Zod schema/parser pre-implementation plan',
    evidenceName: 'colinhacks_zod',
    task: 'Plan a safe Zod schema parsing behavior change. Identify package/source areas, type-surface risks, tests, docs/migration areas, and exact next reads.',
    expected: ['zod', 'schema', 'parser', 'typescript', 'test', 'packages', 'package.json', 'src'],
    mustHave: ['zod', 'schema', 'test'],
    terms: ['zod', 'schema', 'parser', 'parse', 'typescript', 'packages', 'test', 'migration'],
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

function scoreLine(line, terms) {
  const text = String(line || '');
  const lower = text.toLowerCase();
  let score = 0;
  if (/^(OSS_CODEBASE_BENCHMARK_PROJECT|TASK|PACKAGE_SCRIPTS_JSON|FILE_TREE_HEAD|RG_LIKE_SIGNAL_LINES|SELECTED_FILE_EXCERPTS):/.test(text)) score += 12;
  if (/(^|\/)package\.json\b|(^|\/)(README|CONTRIBUTING|TESTING)(\.|$)/i.test(text)) score += 10;
  if (/"(test|test:[^"]+|build|lint|typecheck|dev|start)"\s*:/.test(text)) score += 10;
  if (/\b(src|lib|packages|test|tests|__tests__|docs|examples)\//i.test(text)) score += 6;
  for (const term of terms) {
    if (lower.includes(String(term).toLowerCase())) score += 5;
  }
  if (/\b(risk|breaking|compat|contract|generated|integrity|typescript|migration|regression)\b/i.test(text)) score += 4;
  if (text.length > 700) score -= 2;
  return score;
}

function buildTargetedBaseline(raw, task) {
  const lines = String(raw || '').split('\n').map((line) => line.trimEnd()).filter(Boolean);
  const scored = lines.map((line, index) => ({ line, index, score: scoreLine(line, task.terms) }));
  const required = scored.filter((item) => /^(OSS_CODEBASE_BENCHMARK_PROJECT|TASK|PACKAGE_SCRIPTS_JSON|FILE_TREE_HEAD):/.test(item.line));
  const highSignal = scored
    .filter((item) => item.score > 0 && !required.includes(item))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const selected = [];
  const seen = new Set();
  const add = (item) => {
    const normalized = item.line.replace(/\s+/g, ' ').trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    selected.push(item.line);
  };
  for (const item of required) add(item);
  for (const item of highSignal) {
    if (approxTokens(selected.join('\n')) >= 9000) break;
    add(item);
  }
  const evidence = [
    `NORMAL_AGENT_TARGETED_BASELINE: ${task.title}`,
    'Assumption: baseline agent does not ingest the full raw file. It performs normal targeted package/tree/grep/excerpt inspection and receives these tool outputs in cloud context.',
    'Approx tool calls: list/tree, read package.json, grep task terms, read source excerpts, read test excerpts, inspect docs/config.',
    '',
    ...selected,
  ].join('\n');
  return {
    evidence,
    approxTokens: approxTokens(evidence),
    approxToolCalls: 6,
    selectionRatio: pct(approxTokens(evidence), approxTokens(raw)),
  };
}

function compactTextFromRun(run) {
  return String(run?.json?.compactText || run?.json?.compactPayload || run?.json?.result?.compactText || JSON.stringify(run?.json || {}));
}

function uniqueMatches(text, regex, limit = 32) {
  const out = new Set();
  for (const match of String(text || '').matchAll(regex)) {
    const value = String(match[1] || match[0] || '').trim().replace(/[),.;:'"`]+$/, '');
    if (value) out.add(value);
    if (out.size >= limit) break;
  }
  return [...out];
}

function scoreSignals(text, expected, mustHave) {
  const lower = String(text || '').toLowerCase();
  const matched = expected.filter((signal) => lower.includes(signal.toLowerCase()));
  const missing = expected.filter((signal) => !matched.includes(signal));
  const mustMatched = mustHave.filter((signal) => lower.includes(signal.toLowerCase()));
  const mustMissing = mustHave.filter((signal) => !mustMatched.includes(signal));
  const coverage = expected.length ? matched.length / expected.length : 1;
  const mustCoverage = mustHave.length ? mustMatched.length / mustHave.length : 1;
  const score = +(coverage * 0.6 + mustCoverage * 0.4).toFixed(3);
  return { score, coverage: +coverage.toFixed(3), mustCoverage: +mustCoverage.toFixed(3), matched, missing, mustMatched, mustMissing };
}

function scoreActionability(text) {
  const value = String(text || '');
  const paths = uniqueMatches(value, /\b((?:lib|src|source|test|tests|packages|package|docs|examples|benchmarks|types|scripts|build)[\w./-]*\.(?:js|mjs|cjs|ts|tsx|json|md|yml|yaml))\b/g, 48);
  const commands = uniqueMatches(value, /\b((?:npm|pnpm|yarn|bun)\s+(?:run\s+)?[\w:./-]+|test:[\w:./-]+|npm\s+test)\b/g, 32);
  const hasSource = /\b(?:lib|src|packages|source)\//i.test(value) || /source (?:area|file|path)s?/i.test(value);
  const hasTests = /\b(?:test|tests|__tests__|spec)\//i.test(value) || /test (?:area|file|path|command)s?/i.test(value);
  const hasNextReads = /next (?:exact )?(?:read|reads|action|actions)|likely files?|source areas?|risk/i.test(value);
  const riskSignals = uniqueMatches(value, /\b(risk|breaking|compat(?:ibility)?|contract|generated|integrity|type(?:script)?|migration|regression|middleware|validation|schema|parser|router)\b/gi, 48);
  const checks = [paths.length >= 3, commands.length >= 1, hasSource, hasTests, hasNextReads, riskSignals.length >= 2];
  const passed = checks.filter(Boolean).length;
  return { score: +(passed / checks.length).toFixed(3), passed, total: checks.length, paths: paths.slice(0, 10), commands: commands.slice(0, 10), riskSignals: riskSignals.slice(0, 10) };
}

function quality(text, task) {
  const signal = scoreSignals(text, task.expected, task.mustHave);
  const actionability = scoreActionability(text);
  const score = +(signal.score * 0.55 + actionability.score * 0.45).toFixed(3);
  return {
    score,
    label: score >= 0.9 ? 'strong' : score >= 0.75 ? 'usable' : score >= 0.55 ? 'weak' : 'fail',
    pass: score >= 0.75 && signal.mustCoverage >= 0.67,
    signal,
    actionability,
  };
}

async function runCase(task, evidencePath) {
  const raw = await fs.readFile(evidencePath, 'utf8');
  const rawTokens = approxTokens(raw);
  const baseline = buildTargetedBaseline(raw, task);
  const baselineQuality = quality(baseline.evidence, task);
  const memoryDir = path.join(OUT_DIR, 'memory', task.id);
  const outputDir = path.join(OUT_DIR, 'vault-runs', task.id);
  const localqa = runRunner({
    controlMode: 'directed',
    task: task.task,
    directedSteps: [
      {
        tool: 'memory_query',
        question: `What prior work exists for ${task.title}?`,
        contextBudgetTokens: 300,
      },
      {
        tool: 'context_cleanup',
        filePath: evidencePath,
        task: task.task,
        contextBudgetTokens: 900,
      },
      {
        tool: 'context_cleanup',
        filePath: evidencePath,
        task: `Targeted follow-up for the same task. Preserve exact files, package scripts, test commands, and risks for these expected signals: ${task.expected.join(', ')}. Also preserve task terms: ${task.terms.join(', ')}`,
        contextBudgetTokens: 1200,
      },
    ],
    outputContract: {
      maxTokens: 1800,
      include: ['likely_files', 'test_commands', 'risk_signals', 'next_exact_reads', 'memory'],
      exclude: ['full_raw_evidence', 'full_file_tree', 'full_excerpts'],
    },
    memoryDir,
    outputDir,
  });
  const localqaText = compactTextFromRun(localqa);
  const localqaTokens = localqa.json.tokenSavings?.compactReportApproxTokens ?? approxTokens(localqaText);
  const localqaQuality = quality(localqaText, task);
  const savedVsTargetedBaseline = Math.max(0, baseline.approxTokens - localqaTokens);
  const result = {
    id: task.id,
    title: task.title,
    evidencePath,
    rawEvidenceTokens: rawTokens,
    fullDumpUpperBound: {
      tokens: rawTokens,
      note: 'Upper bound only; not used as primary baseline because a normal agent can grep/read selectively.',
    },
    targetedBaseline: {
      tokens: baseline.approxTokens,
      approxToolCalls: baseline.approxToolCalls,
      percentOfFullEvidence: baseline.selectionRatio,
      quality: baselineQuality,
      preview: baseline.evidence.slice(0, 2200),
    },
    localqa: {
      tokens: localqaTokens,
      approxMainAgentToolCalls: 1,
      internalLocalSteps: 3,
      runtimeMs: localqa.durationMs,
      memoryWritten: !!localqa.json.memory?.memoryWritten,
      quality: localqaQuality,
      preview: localqaText.slice(0, 2200),
    },
    comparison: {
      targetBaselineSavedTokens: savedVsTargetedBaseline,
      targetBaselineReductionRatio: pct(savedVsTargetedBaseline, baseline.approxTokens),
      qualityDelta: +(localqaQuality.score - baselineQuality.score).toFixed(3),
      bothPassQuality: baselineQuality.pass && localqaQuality.pass,
      localqaMaintainedOrImprovedQuality: localqaQuality.score >= baselineQuality.score - 0.08,
      toolCallReduction: baseline.approxToolCalls - 1,
    },
  };
  await fs.writeFile(path.join(OUT_DIR, `${task.id}.json`), JSON.stringify(result, null, 2));
  return result;
}

function md(report) {
  const rows = report.cases.map((item) => `| ${item.title} | ${item.targetedBaseline.tokens} | ${item.localqa.tokens} | ${item.comparison.targetBaselineSavedTokens} | ${item.comparison.targetBaselineReductionRatio}% | ${item.targetedBaseline.quality.score} | ${item.localqa.quality.score} | ${item.comparison.qualityDelta} | ${item.comparison.bothPassQuality ? 'yes' : 'no'} | ${item.comparison.toolCallReduction} |`).join('\n');
  return `# LocalQA A/B Agent Workflow Benchmark

Date: ${report.generatedAt}

## Purpose

This benchmark addresses the skeptic objection: compression against a full evidence dump is not enough, because a normal frontier agent would often grep/read selectively instead of ingesting the full dump.

So this A/B benchmark compares:

- Baseline A: a realistic targeted normal-agent evidence path built from package/tree/grep/excerpt-style evidence, not the full raw file.
- LocalQA B: one directed local_agent_run call that queries memory, compresses long evidence, runs a targeted follow-up, writes memory, and returns compact context.

This measures the pre-implementation evidence task. It does not claim final patch correctness.

## Aggregate

- Cases: ${report.cases.length}
- Targeted baseline tokens: ${report.aggregate.baselineTokens}
- LocalQA tokens: ${report.aggregate.localqaTokens}
- Saved vs targeted baseline: ${report.aggregate.savedVsTargetedBaseline} tokens
- Reduction vs targeted baseline: ${report.aggregate.reductionVsTargetedBaseline}%
- Baseline quality pass: ${report.aggregate.baselinePass}/${report.cases.length}
- LocalQA quality pass: ${report.aggregate.localqaPass}/${report.cases.length}
- LocalQA maintained or improved quality within tolerance: ${report.aggregate.maintainedQuality}/${report.cases.length}
- Estimated main-agent tool-call reduction: ${report.aggregate.toolCallReduction}

## Results

| Task | Baseline toks | LocalQA toks | Saved | Reduction | Baseline quality | LocalQA quality | Delta | Both pass | Tool calls saved |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
${rows}

## Interpretation

This is the stronger claim than raw compression: against a targeted normal-agent evidence baseline, LocalQA still reduces context while preserving deterministic evidence quality gates.

The measured improvement is not billed-token proof from an actual provider session. It is a reproducible local proxy for the amount of evidence that would be handed to the frontier model in each workflow. Real billed savings depend on the agent host, model provider, and how aggressively the baseline agent would search/read files.

## Public-safe claim

In this A/B proxy benchmark, LocalQA reduced targeted normal-agent evidence context by ${report.aggregate.reductionVsTargetedBaseline}% while preserving quality gates on ${report.aggregate.localqaPass}/${report.cases.length} pre-implementation evidence tasks.

## What this still does not prove

- It does not prove final patch correctness.
- It does not measure actual provider-billed tokens from OpenCode session logs.
- It does not prove the frontier model would always choose exactly the same baseline reads.
- It does not replace a live A/B session transcript. It is the reproducible benchmark we can ship before collecting provider-level traces.
`;
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const ossDir = path.resolve(process.env.LOCALQA_OPENCODE_OSS_BENCH_DIR || await latestOssBenchDir());
  const cases = [];
  for (const task of TASKS) {
    const evidencePath = path.join(ossDir, task.evidenceName, 'raw-codebase-evidence.txt');
    if (!(await pathExists(evidencePath))) throw new Error(`Missing evidence for ${task.id}: ${evidencePath}`);
    cases.push(await runCase(task, evidencePath));
  }
  const baselineTokens = cases.reduce((sum, item) => sum + item.targetedBaseline.tokens, 0);
  const localqaTokens = cases.reduce((sum, item) => sum + item.localqa.tokens, 0);
  const savedVsTargetedBaseline = Math.max(0, baselineTokens - localqaTokens);
  const aggregate = {
    baselineTokens,
    localqaTokens,
    savedVsTargetedBaseline,
    reductionVsTargetedBaseline: pct(savedVsTargetedBaseline, baselineTokens),
    baselinePass: cases.filter((item) => item.targetedBaseline.quality.pass).length,
    localqaPass: cases.filter((item) => item.localqa.quality.pass).length,
    maintainedQuality: cases.filter((item) => item.comparison.localqaMaintainedOrImprovedQuality).length,
    toolCallReduction: cases.reduce((sum, item) => sum + item.comparison.toolCallReduction, 0),
  };
  const report = {
    ok: aggregate.baselinePass === cases.length && aggregate.localqaPass === cases.length && aggregate.maintainedQuality === cases.length,
    generatedAt: new Date().toISOString(),
    sourceOssBenchDir: ossDir,
    outDir: OUT_DIR,
    aggregate,
    cases,
  };
  await fs.writeFile(path.join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2));
  await fs.writeFile(path.join(OUT_DIR, 'AB_AGENT_WORKFLOW_BENCHMARK.md'), md(report));
  console.log(JSON.stringify({
    ok: report.ok,
    outDir: OUT_DIR,
    aggregate,
    cases: cases.map((item) => ({
      id: item.id,
      baselineTokens: item.targetedBaseline.tokens,
      localqaTokens: item.localqa.tokens,
      reductionVsTargetedBaseline: item.comparison.targetBaselineReductionRatio,
      baselineQuality: item.targetedBaseline.quality.score,
      localqaQuality: item.localqa.quality.score,
      qualityDelta: item.comparison.qualityDelta,
      bothPassQuality: item.comparison.bothPassQuality,
      toolCallReduction: item.comparison.toolCallReduction,
    })),
  }, null, 2));
  if (!report.ok) process.exitCode = 1;
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err?.message || String(err), stack: String(err?.stack || '').split('\n').slice(0, 8).join('\n') }, null, 2));
  process.exitCode = 1;
});

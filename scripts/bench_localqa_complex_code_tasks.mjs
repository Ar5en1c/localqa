#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const RUN_DATE = process.env.LOCALQA_REPORT_DATE || new Date().toISOString().slice(0, 10);
const OUT_DIR = path.resolve(process.env.LOCALQA_COMPLEX_CODE_TASK_OUT_DIR || `reports/localqa/complex_code_tasks_${RUN_DATE}`);
const RUNNER = path.resolve('scripts/localqa-opencode-runner.mjs');
const BUDGETS = [800, 1600, 3200];

const TASKS = [
  {
    id: 'express_router_middleware_change',
    project: 'expressjs/express',
    evidenceName: 'expressjs_express',
    category: 'multi-file orientation + fix planning',
    task: 'Complex task: A maintainer wants to change routing or middleware behavior in Express. Identify the likely source areas, test areas, npm test command signals, and risks before editing. Return only compact codebase evidence for a frontier model to plan a patch.',
    expected: ['express', 'router', 'middleware', 'mocha', 'test', 'package.json'],
    mustHave: ['router', 'middleware', 'test'],
  },
  {
    id: 'fastify_validation_error_contract',
    project: 'fastify/fastify',
    evidenceName: 'fastify_fastify',
    category: 'cross-file behavior contract',
    task: 'Complex task: A maintainer wants to change Fastify validation/error response behavior. Identify likely source files, generated/validator integrity checks, test command signals, TypeScript checks, and maintenance risks before editing. Return compact evidence for a frontier model to plan a patch.',
    expected: ['fastify', 'validation', 'error-handler', 'test:validator:integrity', 'test:typescript', 'lib/validation.js', 'lib/error-handler.js', 'test'],
    mustHave: ['validation', 'test:validator:integrity', 'test:typescript'],
  },
  {
    id: 'zod_schema_parser_change',
    project: 'colinhacks/zod',
    evidenceName: 'colinhacks_zod',
    category: 'library API/type-surface change',
    task: 'Complex task: A maintainer wants to change Zod schema parsing behavior. Identify likely package/source areas, test/type-check command signals, TypeScript/type-surface risks, and docs or migration areas before editing. Return compact evidence for a frontier model to plan a patch.',
    expected: ['zod', 'schema', 'test', 'typescript', 'package.json', 'packages', 'src'],
    mustHave: ['zod', 'schema', 'test'],
  },
];

function approxTokens(value) {
  return Math.ceil(String(value || '').length / 4);
}

function pct(saved, raw) {
  return raw > 0 ? +((saved / raw) * 100).toFixed(2) : 0;
}

function sanitizeMd(value) {
  return String(value ?? '').replaceAll('|', '\\|').replace(/\s+/g, ' ').trim();
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
  if (!dirs.length) {
    throw new Error('No opencode_oss_codebases_* report found. Run npm run localqa:bench:opencode-oss-codebases first.');
  }
  return dirs.at(-1);
}

function runLocalQa(args) {
  const startedAt = performance.now();
  const stdout = execFileSync('node', [RUNNER], {
    input: JSON.stringify(args),
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 20,
  });
  return {
    durationMs: +(performance.now() - startedAt).toFixed(2),
    result: JSON.parse(stdout),
  };
}

function scoreText(text, expected, mustHave) {
  const lower = String(text || '').toLowerCase();
  const matched = expected.filter((signal) => lower.includes(signal.toLowerCase()));
  const missing = expected.filter((signal) => !matched.includes(signal));
  const mustMatched = mustHave.filter((signal) => lower.includes(signal.toLowerCase()));
  const mustMissing = mustHave.filter((signal) => !mustMatched.includes(signal));
  const coverage = expected.length ? matched.length / expected.length : 1;
  const mustCoverage = mustHave.length ? mustMatched.length / mustHave.length : 1;
  const score = +(coverage * 0.65 + mustCoverage * 0.35).toFixed(3);
  return {
    score,
    coverage: +coverage.toFixed(3),
    mustCoverage: +mustCoverage.toFixed(3),
    matched,
    missing,
    mustMatched,
    mustMissing,
    pass: score >= 0.72 && mustCoverage >= 0.67,
  };
}

function uniqueMatches(text, regex, limit = 24) {
  const found = new Set();
  for (const match of String(text || '').matchAll(regex)) {
    const value = String(match[1] || match[0] || '').trim().replace(/[),.;:'"`]+$/, '');
    if (value) found.add(value);
    if (found.size >= limit) break;
  }
  return [...found];
}

function actionabilityScore(text) {
  const value = String(text || '');
  const pathHits = uniqueMatches(value, /\b((?:lib|src|source|test|tests|packages|package|docs|examples|benchmarks|types|scripts|build)[\w./-]*\.(?:js|mjs|cjs|ts|tsx|json|md|yml|yaml))\b/g, 32);
  const testCommandHits = uniqueMatches(value, /\b((?:npm|pnpm|yarn|bun)\s+(?:run\s+)?[\w:./-]+|test:[\w:./-]+|npm\s+test)\b/g, 24);
  const hasSourceArea = /\b(?:lib|src|packages|source)\//i.test(value) || /\bsource (?:area|file|path)s?\b/i.test(value);
  const hasTestArea = /\b(?:test|tests|__tests__|spec)\//i.test(value) || /\btest (?:area|file|path|command)s?\b/i.test(value);
  const hasPackageSignal = /\bpackage\.json\b/i.test(value) || /\b(?:scripts|dependencies|devdependencies)\b/i.test(value);
  const riskHits = uniqueMatches(value, /\b(risk|breaking|compat(?:ibility)?|contract|generated|integrity|type(?:script)?|migration|regression|middleware|validation|schema|parser|router)\b/gi, 32);
  const checks = [
    pathHits.length >= 3,
    testCommandHits.length >= 1,
    hasSourceArea,
    hasTestArea,
    hasPackageSignal,
    riskHits.length >= 2,
  ];
  const passedChecks = checks.filter(Boolean).length;
  const score = +(passedChecks / checks.length).toFixed(3);
  return {
    score,
    passedChecks,
    totalChecks: checks.length,
    pass: score >= 0.667,
    filePathCount: pathHits.length,
    testCommandCount: testCommandHits.length,
    hasSourceArea,
    hasTestArea,
    hasPackageSignal,
    riskSignalCount: riskHits.length,
    samplePaths: pathHits.slice(0, 8),
    sampleTestCommands: testCommandHits.slice(0, 8),
    sampleRiskSignals: riskHits.slice(0, 8),
  };
}

function frontierReadiness(signalScore, actionability) {
  const score = +(signalScore.score * 0.5 + actionability.score * 0.5).toFixed(3);
  return {
    score,
    signalScore: signalScore.score,
    actionabilityScore: actionability.score,
    pass: signalScore.pass && actionability.pass,
    label: signalScore.pass && actionability.pass
      ? 'orientation-ready'
      : signalScore.pass
        ? 'needs-targeted-evidence'
        : 'not-ready',
  };
}

function targetedTask(baseTask, missing) {
  return `${baseTask}\n\nTargeted follow-up: the first compact pass was missing these important signals: ${missing.join(', ')}. Search the same local evidence for these exact signals and return only the missing source/test/command evidence.`;
}

async function runTask(task, evidencePath, caseOutDir) {
  const rawText = await fs.readFile(evidencePath, 'utf8');
  const rawApproxTokens = approxTokens(rawText);
  const singlePasses = [];

  for (const budget of BUDGETS) {
    const run = runLocalQa({
      mode: 'context_cleanup',
      task: task.task,
      filePath: evidencePath,
      contextBudgetTokens: budget,
      outputDir: path.join(caseOutDir, 'vault-runs'),
    });
    const compact = run.result.compactText || run.result.compactPayload || JSON.stringify(run.result, null, 2);
    const score = scoreText(compact, task.expected, task.mustHave);
    const actionability = actionabilityScore(compact);
    singlePasses.push({
      budget,
      durationMs: run.durationMs,
      selectedMode: run.result.selectedMode,
      telemetry: run.result.telemetry,
      tokenSavings: run.result.tokenSavings,
      compactApproxTokens: run.result.tokenSavings?.compactReportApproxTokens ?? approxTokens(compact),
      rawApproxTokens: run.result.tokenSavings?.rawEvidenceApproxTokens ?? rawApproxTokens,
      savedApproxTokens: run.result.tokenSavings?.savedApproxTokens ?? Math.max(0, rawApproxTokens - approxTokens(compact)),
      reductionRatio: run.result.tokenSavings?.reductionRatio ?? pct(Math.max(0, rawApproxTokens - approxTokens(compact)), rawApproxTokens),
      score,
      actionability,
      frontierReadiness: frontierReadiness(score, actionability),
      compactPreview: compact.slice(0, 2400),
    });
  }

  const first = singlePasses.find((item) => item.budget === 800);
  let targeted = null;
  if (first?.score?.missing?.length) {
    const follow = runLocalQa({
      mode: 'context_cleanup',
      task: targetedTask(task.task, first.score.missing),
      filePath: evidencePath,
      contextBudgetTokens: 800,
      outputDir: path.join(caseOutDir, 'vault-runs'),
    });
    const followCompact = follow.result.compactText || follow.result.compactPayload || JSON.stringify(follow.result, null, 2);
    const combinedText = `${first.compactPreview}\n\n${followCompact}`;
    const combinedScore = scoreText(combinedText, task.expected, task.mustHave);
    const combinedActionability = actionabilityScore(combinedText);
    const compactApproxTokens = first.compactApproxTokens + (follow.result.tokenSavings?.compactReportApproxTokens ?? approxTokens(followCompact));
    targeted = {
      strategy: '800_overview_plus_800_targeted_followup',
      durationMs: +(first.durationMs + follow.durationMs).toFixed(2),
      compactApproxTokens,
      savedApproxTokens: Math.max(0, rawApproxTokens - compactApproxTokens),
      reductionRatio: pct(Math.max(0, rawApproxTokens - compactApproxTokens), rawApproxTokens),
      firstScore: first.score,
      followScore: scoreText(followCompact, task.expected, task.mustHave),
      combinedScore,
      combinedActionability,
      frontierReadiness: frontierReadiness(combinedScore, combinedActionability),
      followCompactPreview: followCompact.slice(0, 1800),
    };
  }

  const bestSingle = [...singlePasses].sort((a, b) => b.frontierReadiness.score - a.frontierReadiness.score || a.compactApproxTokens - b.compactApproxTokens)[0];
  const recommended = targeted && targeted.frontierReadiness.score >= bestSingle.frontierReadiness.score && targeted.compactApproxTokens <= bestSingle.compactApproxTokens * 1.15
    ? { strategy: targeted.strategy, score: targeted.frontierReadiness.score, label: targeted.frontierReadiness.label, compactApproxTokens: targeted.compactApproxTokens, reductionRatio: targeted.reductionRatio }
    : { strategy: `single_${bestSingle.budget}`, score: bestSingle.frontierReadiness.score, label: bestSingle.frontierReadiness.label, compactApproxTokens: bestSingle.compactApproxTokens, reductionRatio: bestSingle.reductionRatio };

  const result = {
    id: task.id,
    project: task.project,
    category: task.category,
    evidencePath,
    rawApproxTokens,
    expected: task.expected,
    mustHave: task.mustHave,
    singlePasses,
    targeted,
    recommended,
  };
  await fs.writeFile(path.join(caseOutDir, `${task.id}.json`), JSON.stringify(result, null, 2));
  return result;
}

function markdown(report) {
  const totalsByBudget = report.budgets.map((budget) => {
    const passes = report.tasks.map((task) => task.singlePasses.find((pass) => pass.budget === budget)).filter(Boolean);
    const raw = passes.reduce((sum, pass) => sum + pass.rawApproxTokens, 0);
    const compact = passes.reduce((sum, pass) => sum + pass.compactApproxTokens, 0);
    const saved = Math.max(0, raw - compact);
    const ready = passes.filter((pass) => pass.frontierReadiness.pass).length;
    return { budget, raw, compact, saved, reduction: pct(saved, raw), ready, total: passes.length };
  });
  const recommendedRaw = report.tasks.reduce((sum, task) => {
    const pass = task.singlePasses[0];
    return sum + (pass?.rawApproxTokens || task.rawApproxTokens || 0);
  }, 0);
  const recommendedCompact = report.tasks.reduce((sum, task) => sum + task.recommended.compactApproxTokens, 0);
  const recommendedSaved = Math.max(0, recommendedRaw - recommendedCompact);
  const rows = report.tasks.flatMap((task) => task.singlePasses.map((pass) => `| ${task.project} | ${task.category} | single ${pass.budget} | ${pass.rawApproxTokens} | ${pass.compactApproxTokens} | ${pass.reductionRatio}% | ${pass.score.score} | ${pass.actionability.score} | ${pass.frontierReadiness.score} | ${pass.frontierReadiness.label} | ${pass.actionability.filePathCount} | ${pass.actionability.testCommandCount} | ${pass.score.matched.length}/${task.expected.length} | ${pass.frontierReadiness.pass ? 'yes' : 'no'} |`));
  const targetedRows = report.tasks.map((task) => {
    if (!task.targeted) return `| ${task.project} | ${task.category} | n/a | n/a | n/a | n/a | n/a | n/a |`;
    const t = task.targeted;
    return `| ${task.project} | ${task.category} | ${t.compactApproxTokens} | ${t.reductionRatio}% | ${t.frontierReadiness.score} | ${t.frontierReadiness.label} | ${t.combinedScore.matched.length}/${task.expected.length} | ${t.frontierReadiness.pass ? 'yes' : 'no'} |`;
  }).join('\n');
  const recRows = report.tasks.map((task) => `| ${task.project} | ${task.recommended.strategy} | ${task.recommended.compactApproxTokens} | ${task.recommended.reductionRatio}% | ${task.recommended.score} | ${task.recommended.label} |`).join('\n');
  const totalRows = totalsByBudget.map((item) => `| single ${item.budget} | ${item.raw} | ${item.compact} | ${item.saved} | ${item.reduction}% | ${item.ready}/${item.total} |`).join('\n');
  const allPasses = report.tasks.flatMap((task) => task.singlePasses);
  const passing = allPasses.filter((pass) => pass.frontierReadiness.pass);
  return `# LocalQA Complex Code Task Benchmark

Date: ${report.generatedAt}

## Purpose

This benchmark tests whether LocalQA compact evidence is useful for complex code tasks, not just small. It uses real OSS codebase evidence bundles and scores whether compact output preserves source areas, test commands, package signals, and maintenance-risk signals a frontier coding model would need before planning a patch.

This is a frontier-model-support benchmark, not a replacement-model benchmark. LocalQA is evaluated as the local evidence worker that feeds the main model smaller, targeted context.

## Summary

- Tasks: ${report.tasks.length}
- Single-pass profiles: ${allPasses.length}
- Frontier-ready single-pass profiles: ${passing.length}/${allPasses.length}
- Recommended total: ${recommendedRaw} raw tokens -> ${recommendedCompact} compact tokens, ${pct(recommendedSaved, recommendedRaw)}% reduction.
- Recommended strategy: use the smallest profile that preserves both broad signals and actionability gates; follow with targeted handle/file reads before editing.

## Token savings by profile

| Profile | Raw toks | Compact toks | Saved toks | Reduction | Frontier-ready |
|---|---:|---:|---:|---:|---:|
${totalRows}

## Single-pass results

| Project | Task category | Profile | Raw toks | Compact toks | Reduction | Signal score | Actionability | Frontier score | Label | Paths | Test cmds | Signals | Pass |
|---|---|---|---:|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|
${rows.join('\n')}

## Two-pass targeted results

| Project | Task category | Compact toks | Reduction | Frontier score | Label | Signals | Pass |
|---|---|---:|---:|---:|---|---:|---:|
${targetedRows}

## Recommended use per task

| Project | Recommended strategy | Compact toks | Reduction | Frontier score | Label |
|---|---|---:|---:|---:|---|
${recRows}

## What the actionability gate checks

- At least 3 path-like source/test/config/doc references.
- At least 1 package/test command signal.
- Separate source-area and test-area signals.
- Package/script metadata.
- At least 2 risk or behavior-contract signals.

## Interpretation

- LocalQA can save large amounts of context while preserving enough task signals for orientation and pre-patch planning.
- 800 tokens is a credible scout pass when actionability gates pass. It is not a patching context by itself.
- 1600 tokens is the practical default when the task is ambiguous or when the user expects the main model to reason about tradeoffs.
- 3200 tokens is safer when the main model must plan edits across multiple files, but it still should use exact file reads before changing code.
- The best UX is not one giant context dump. It is first-pass local overview plus targeted follow-up queries when a signal is missing.

## Limits found

- This does not prove the compact report is enough to implement a patch without reading exact files. For patching, the main model still needs targeted file reads or handle queries.
- The actionability gate measures evidence preservation. It does not grade semantic patch correctness.
- Raw evidence construction is an approximation of what a normal agent would collect through several file/list/grep reads.

## Public-safe claim

For these complex OSS codebase tasks, LocalQA reduced raw codebase evidence by the measured ratios below while preserving a scored set of source/test/build/actionability signals. It is best positioned as a local evidence compressor and task router for frontier coding models, not as a standalone replacement for them.
`;
}
async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const ossDir = path.resolve(process.env.LOCALQA_OPENCODE_OSS_BENCH_DIR || await latestOssBenchDir());
  const tasks = [];
  for (const task of TASKS) {
    const evidencePath = path.join(ossDir, task.evidenceName, 'raw-codebase-evidence.txt');
    if (!(await pathExists(evidencePath))) throw new Error(`Missing evidence for ${task.id}: ${evidencePath}`);
    tasks.push(await runTask(task, evidencePath, OUT_DIR));
  }
  const report = {
    generatedAt: new Date().toISOString(),
    sourceOssBenchDir: ossDir,
    outDir: OUT_DIR,
    budgets: BUDGETS,
    tasks,
  };
  await fs.writeFile(path.join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2));
  await fs.writeFile(path.join(OUT_DIR, 'COMPLEX_CODE_TASK_BENCHMARK.md'), markdown(report));
  console.log(JSON.stringify({
    ok: true,
    outDir: OUT_DIR,
    sourceOssBenchDir: ossDir,
    tasks: tasks.map((task) => ({
      id: task.id,
      project: task.project,
      recommended: task.recommended,
      singlePasses: task.singlePasses.map((pass) => ({
        budget: pass.budget,
        compactApproxTokens: pass.compactApproxTokens,
        reductionRatio: pass.reductionRatio,
        score: pass.score.score,
        pass: pass.score.pass,
        missing: pass.score.missing,
      })),
      targeted: task.targeted ? {
        compactApproxTokens: task.targeted.compactApproxTokens,
        reductionRatio: task.targeted.reductionRatio,
        score: task.targeted.combinedScore.score,
        pass: task.targeted.combinedScore.pass,
        missing: task.targeted.combinedScore.missing,
      } : null,
    })),
  }, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err?.message || String(err), stack: String(err?.stack || '').split('\n').slice(0, 8).join('\n') }, null, 2));
  process.exitCode = 1;
});

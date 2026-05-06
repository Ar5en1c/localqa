#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const RUN_DATE = process.env.LOCALQA_REPORT_DATE || new Date().toISOString().slice(0, 10);
const OUT_DIR = path.resolve(process.env.LOCALQA_LAUNCH_CHECK_OUT_DIR || `reports/localqa/launch_check_${RUN_DATE}`);

function run(name, cmd, args = []) {
  const startedAt = performance.now();
  try {
    const stdout = execFileSync(cmd, args, {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 80,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return {
      name,
      ok: true,
      cmd: [cmd, ...args].join(' '),
      durationMs: +(performance.now() - startedAt).toFixed(2),
      stdout: stdout.slice(-6000),
      stderr: '',
    };
  } catch (err) {
    return {
      name,
      ok: false,
      cmd: [cmd, ...args].join(' '),
      durationMs: +(performance.now() - startedAt).toFixed(2),
      stdout: String(err?.stdout || '').slice(-6000),
      stderr: String(err?.stderr || err?.message || '').slice(-6000),
      exitCode: err?.status ?? 1,
    };
  }
}

async function readJsonIfExists(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

function pct(saved, raw) {
  return raw > 0 ? +((saved / raw) * 100).toFixed(2) : 0;
}

function summarizeComplex(report) {
  if (!report?.tasks?.length) return null;
  const byBudget = new Map();
  for (const task of report.tasks) {
    for (const pass of task.singlePasses || []) {
      const item = byBudget.get(pass.budget) || { budget: pass.budget, raw: 0, compact: 0, ready: 0, total: 0 };
      item.raw += Number(pass.rawApproxTokens || 0);
      item.compact += Number(pass.compactApproxTokens || 0);
      item.ready += pass.frontierReadiness?.pass || pass.score?.pass ? 1 : 0;
      item.total += 1;
      byBudget.set(pass.budget, item);
    }
  }
  const profiles = [...byBudget.values()].sort((a, b) => a.budget - b.budget).map((item) => ({
    ...item,
    saved: Math.max(0, item.raw - item.compact),
    reductionRatio: pct(Math.max(0, item.raw - item.compact), item.raw),
  }));
  return {
    taskCount: report.tasks.length,
    profiles,
    bestScout: profiles.find((item) => item.budget === 800) || profiles[0],
  };
}

function summarizeAgentLayer(report) {
  if (!report?.results?.length) return null;
  const directed = report.results.find((item) => item.name === 'directed_memory_plus_codebase_cleanup');
  const strict = report.results.find((item) => item.name === 'strict_rejects_unknown_tool');
  const handoff = report.results.find((item) => item.name === 'directed_handoff_redaction');
  const memory = report.results.find((item) => item.name === 'query_project_memory');
  return {
    evidenceApproxTokens: report.evidenceApproxTokens,
    directed,
    strictRejected: strict?.ok === false,
    handoffNoLeak: handoff?.leakedSyntheticSecret === false,
    memory,
  };
}

function summarizeAgentic(report) {
  if (!report?.aggregate || !Array.isArray(report?.workflows)) return null;
  return {
    aggregate: report.aggregate,
    workflows: report.workflows.map((item) => ({
      id: item.id,
      title: item.title,
      rawTokens: item.rawTokens,
      compactTokens: item.localqaWorkflow?.compactContextApproxTokens,
      savedTokens: item.localqaWorkflow?.savedApproxTokens,
      reductionRatio: item.localqaWorkflow?.reductionRatio,
      runtimeMs: item.localqaWorkflow?.runtimeMs,
      qualityScore: item.quality?.score,
      qualityLabel: item.quality?.label,
      qualityPass: item.quality?.pass,
      memoryWritten: item.localqaWorkflow?.memoryWritten,
    })),
  };
}

function summarizeAb(report) {
  if (!report?.aggregate || !Array.isArray(report?.cases)) return null;
  return {
    aggregate: report.aggregate,
    cases: report.cases.map((item) => ({
      id: item.id,
      title: item.title,
      baselineTokens: item.targetedBaseline?.tokens,
      localqaTokens: item.localqa?.tokens,
      savedTokens: item.comparison?.targetBaselineSavedTokens,
      reductionRatio: item.comparison?.targetBaselineReductionRatio,
      baselineQuality: item.targetedBaseline?.quality?.score,
      localqaQuality: item.localqa?.quality?.score,
      qualityDelta: item.comparison?.qualityDelta,
      bothPassQuality: item.comparison?.bothPassQuality,
      toolCallReduction: item.comparison?.toolCallReduction,
    })),
  };
}

function summarizeLongHorizon(report) {
  if (!report?.aggregate || !Array.isArray(report?.phases)) return null;
  return {
    aggregate: report.aggregate,
    projectSummaries: report.projectSummaries || [],
  };
}

function md(report) {
  const commandRows = report.commands.map((item) => `| ${item.name} | ${item.ok ? 'pass' : 'fail'} | ${item.durationMs} | \`${item.cmd}\` |`).join('\n');
  const complexRows = report.complex?.profiles?.map((item) => `| ${item.budget} | ${item.raw} | ${item.compact} | ${item.saved} | ${item.reductionRatio}% | ${item.ready}/${item.total} |`).join('\n') || '';
  const agenticRows = report.agentic?.workflows?.map((item) => `| ${item.title} | ${item.rawTokens} | ${item.compactTokens} | ${item.savedTokens} | ${item.reductionRatio}% | ${item.runtimeMs} | ${item.qualityScore} | ${item.qualityLabel} | ${item.memoryWritten ? 'yes' : 'no'} |`).join('\n') || '';
  const abRows = report.ab?.cases?.map((item) => `| ${item.title} | ${item.baselineTokens} | ${item.localqaTokens} | ${item.savedTokens} | ${item.reductionRatio}% | ${item.baselineQuality} | ${item.localqaQuality} | ${item.qualityDelta} | ${item.bothPassQuality ? 'yes' : 'no'} | ${item.toolCallReduction} |`).join('\n') || '';
  const longRows = report.longHorizon?.projectSummaries?.map((item) => `| ${item.projectTitle} | ${item.rawTokens} | ${item.compactTokens} | ${item.savedTokens} | ${item.reductionRatio}% | ${item.avgQualityScore} | ${item.passCount}/${item.phaseCount} |`).join('\n') || '';
  const directed = report.agentLayer?.directed;
  const memory = report.agentLayer?.memory;
  return `# LocalQA Launch Check

Date: ${report.generatedAt}

## Verdict

${report.ok ? 'PASS: launch evidence is reproducible in this local environment.' : 'FAIL: do not launch until failing checks are fixed.'}

## Commands

| Check | Result | Runtime ms | Command |
|---|---:|---:|---|
${commandRows}

## Public numbers reproduced

### Complex OSS code tasks

| Budget | Raw toks | Compact toks | Saved toks | Reduction | Frontier-ready |
|---:|---:|---:|---:|---:|---:|
${complexRows}

### Agent layer real-env path

- Real evidence approx tokens: ${report.agentLayer?.evidenceApproxTokens ?? 'n/a'}
- Directed local evidence compression: raw=${directed?.tokenSavings?.rawEvidenceApproxTokens ?? 'n/a'}, compact=${directed?.tokenSavings?.compactReportApproxTokens ?? 'n/a'}, saved=${directed?.tokenSavings?.savedApproxTokens ?? 'n/a'}, reduction=${directed?.tokenSavings?.reductionRatio ?? 'n/a'}%
- Directed runtime: ${directed?.durationMs ?? 'n/a'}ms
- Strict unknown-tool rejection: ${report.agentLayer?.strictRejected ? 'pass' : 'fail'}
- Synthetic secret leak check: ${report.agentLayer?.handoffNoLeak ? 'pass' : 'fail'}
- Memory query: raw=${memory?.tokenSavings?.rawEvidenceApproxTokens ?? 'n/a'}, compact=${memory?.tokenSavings?.compactReportApproxTokens ?? 'n/a'}, saved=${memory?.tokenSavings?.savedApproxTokens ?? 'n/a'}, reduction=${memory?.tokenSavings?.reductionRatio ?? 'n/a'}%

### Agentic multi-step workflows

- Aggregate raw tokens: ${report.agentic?.aggregate?.rawTokens ?? 'n/a'}
- Aggregate compact tokens: ${report.agentic?.aggregate?.compactTokens ?? 'n/a'}
- Aggregate saved tokens: ${report.agentic?.aggregate?.savedTokens ?? 'n/a'}
- Aggregate reduction: ${report.agentic?.aggregate?.reductionRatio ?? 'n/a'}%
- Passing quality workflows: ${report.agentic?.aggregate?.passingQuality ?? 'n/a'}/${report.agentic?.workflows?.length ?? 'n/a'}

| Workflow | Raw toks | Compact toks | Saved toks | Reduction | Runtime ms | Quality | Label | Memory |
|---|---:|---:|---:|---:|---:|---:|---|---:|
${agenticRows}

### A/B proxy vs targeted normal-agent evidence

- Targeted baseline tokens: ${report.ab?.aggregate?.baselineTokens ?? 'n/a'}
- LocalQA tokens: ${report.ab?.aggregate?.localqaTokens ?? 'n/a'}
- Saved vs targeted baseline: ${report.ab?.aggregate?.savedVsTargetedBaseline ?? 'n/a'}
- Reduction vs targeted baseline: ${report.ab?.aggregate?.reductionVsTargetedBaseline ?? 'n/a'}%
- Baseline quality pass: ${report.ab?.aggregate?.baselinePass ?? 'n/a'}/${report.ab?.cases?.length ?? 'n/a'}
- LocalQA quality pass: ${report.ab?.aggregate?.localqaPass ?? 'n/a'}/${report.ab?.cases?.length ?? 'n/a'}
- Maintained quality within tolerance: ${report.ab?.aggregate?.maintainedQuality ?? 'n/a'}/${report.ab?.cases?.length ?? 'n/a'}
- Estimated main-agent tool-call reduction: ${report.ab?.aggregate?.toolCallReduction ?? 'n/a'}

| Task | Baseline toks | LocalQA toks | Saved | Reduction | Baseline quality | LocalQA quality | Delta | Both pass | Tool calls saved |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
${abRows}

### Long-horizon 300k task simulation

- Raw baseline tokens: ${report.longHorizon?.aggregate?.rawTokens ?? 'n/a'}
- LocalQA compact tokens: ${report.longHorizon?.aggregate?.compactTokens ?? 'n/a'}
- Saved tokens: ${report.longHorizon?.aggregate?.savedTokens ?? 'n/a'}
- Reduction: ${report.longHorizon?.aggregate?.reductionRatio ?? 'n/a'}%
- Passing phases: ${report.longHorizon?.aggregate?.passCount ?? 'n/a'}/${report.longHorizon?.aggregate ? 9 : 'n/a'}
- Average quality score: ${report.longHorizon?.aggregate?.avgQualityScore ?? 'n/a'}
- Memory-writing phases: ${report.longHorizon?.aggregate?.memoryWrittenCount ?? 'n/a'}/${report.longHorizon?.aggregate ? 9 : 'n/a'}

| Project | Raw toks | Compact toks | Saved toks | Reduction | Avg quality | Pass |
|---|---:|---:|---:|---:|---:|---:|
${longRows}

## Launch-safe claim

LocalQA is a local evidence and memory layer for frontier coding agents. In this local launch check, it reproduced complex OSS code-task compression, directed Fastify evidence compression, multi-step agentic workflow compression, an A/B proxy against targeted normal-agent evidence, and a 300k-token long-horizon task simulation while preserving strict one-tool MCP behavior, redaction smoke coverage, and the full test suite.

## Do not claim

- Do not claim LocalQA replaces frontier coding models.
- Do not claim it intercepts text already pasted into cloud chat.
- Do not claim the A/B proxy is provider-billed token telemetry; real savings depend on the agent host, provider, and baseline agent behavior.
- Do not claim patch correctness from compression benchmarks alone.
- Do not claim all browser QA works without environment-specific Playwright/browser permissions.
`;
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const commands = [
    run('syntax', 'node', ['--check', 'localqa/core/project-memory-core.mjs']),
    run('core syntax', 'node', ['--check', 'localqa/core/local-agent-core.mjs']),
    run('runner syntax', 'node', ['--check', 'scripts/localqa-opencode-runner.mjs']),
    run('agent benchmark syntax', 'node', ['--check', 'scripts/bench_localqa_agent_layer.mjs']),
    run('opencode redaction', 'npm', ['run', 'localqa:opencode:redaction']),
    run('mcp validation', 'npm', ['run', 'localqa:validate']),
    run('test suite', 'npm', ['test']),
    run('agent layer benchmark', 'npm', ['run', 'localqa:bench:agent-layer']),
    run('agentic workflow benchmark', 'npm', ['run', 'localqa:bench:agentic-workflows']),
    run('ab agent workflow benchmark', 'npm', ['run', 'localqa:bench:ab-agent-workflows']),
    run('long horizon 300k benchmark', 'npm', ['run', 'localqa:bench:long-horizon-300k']),
    run('complex code benchmark', 'npm', ['run', 'localqa:bench:complex-code-tasks']),
  ];
  const complexReport = await readJsonIfExists(path.resolve(`reports/localqa/complex_code_tasks_${RUN_DATE}/report.json`));
  const agentReport = await readJsonIfExists(path.resolve(`reports/localqa/agent_layer_real_env_${RUN_DATE}/report.json`));
  const agenticReport = await readJsonIfExists(path.resolve(`reports/localqa/agentic_workflows_${RUN_DATE}/report.json`));
  const abReport = await readJsonIfExists(path.resolve(`reports/localqa/ab_agent_workflows_${RUN_DATE}/report.json`));
  const longHorizonReport = await readJsonIfExists(path.resolve(`reports/localqa/long_horizon_300k_${RUN_DATE}/report.json`));
  const report = {
    ok: commands.every((item) => item.ok),
    generatedAt: new Date().toISOString(),
    outDir: OUT_DIR,
    commands: commands.map((item) => ({
      name: item.name,
      ok: item.ok,
      cmd: item.cmd,
      durationMs: item.durationMs,
      exitCode: item.exitCode,
      stdoutTail: item.stdout,
      stderrTail: item.stderr,
    })),
    complex: summarizeComplex(complexReport),
    agentLayer: summarizeAgentLayer(agentReport),
    agentic: summarizeAgentic(agenticReport),
    ab: summarizeAb(abReport),
    longHorizon: summarizeLongHorizon(longHorizonReport),
  };
  await fs.writeFile(path.join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2));
  await fs.writeFile(path.join(OUT_DIR, 'LOCALQA_LAUNCH_CHECK.md'), md(report));
  console.log(JSON.stringify({
    ok: report.ok,
    outDir: OUT_DIR,
    commands: report.commands.map((item) => ({ name: item.name, ok: item.ok, durationMs: item.durationMs })),
    complexScout: report.complex?.bestScout,
    directed: report.agentLayer?.directed ? {
      durationMs: report.agentLayer.directed.durationMs,
      tokenSavings: report.agentLayer.directed.tokenSavings,
    } : null,
    agentic: report.agentic?.aggregate,
    ab: report.ab?.aggregate,
    longHorizon: report.longHorizon?.aggregate,
    strictRejected: report.agentLayer?.strictRejected,
    handoffNoLeak: report.agentLayer?.handoffNoLeak,
  }, null, 2));
  if (!report.ok) process.exitCode = 1;
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err?.message || String(err), stack: String(err?.stack || '').split('\n').slice(0, 8).join('\n') }, null, 2));
  process.exitCode = 1;
});

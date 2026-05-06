#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';

const RUN_DATE = process.env.LOCALQA_REPORT_DATE || new Date().toISOString().slice(0, 10);
const OUT_DIR = path.resolve(process.env.LOCALQA_PROVIDER_TELEMETRY_OUT_DIR || `reports/localqa/provider_telemetry_${RUN_DATE}`);
const EVIDENCE = path.resolve(process.env.LOCALQA_PROVIDER_TELEMETRY_EVIDENCE || 'reports/localqa/opencode_oss_codebases_2026-05-05/fastify_fastify/raw-codebase-evidence.txt');
const MODEL = process.env.LOCALQA_PROVIDER_TELEMETRY_MODEL || '';

function approxTokens(value) {
  return Math.ceil(String(value || '').length / 4);
}

function runOpenCode(name, args) {
  const eventPath = path.join(OUT_DIR, `${name}-events.jsonl`);
  const startedAt = performance.now();
  const fullArgs = ['run', '--format', 'json', '--title', `LocalQA provider telemetry ${name}`, ...args];
  if (MODEL) fullArgs.splice(3, 0, '--model', MODEL);
  const res = spawnSync('opencode', fullArgs, {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 20,
  });
  const durationMs = +(performance.now() - startedAt).toFixed(2);
  const stdout = res.stdout || '';
  const stderr = res.stderr || '';
  return fs.writeFile(eventPath, stdout).then(() => ({
    name,
    ok: res.status === 0,
    status: res.status,
    durationMs,
    cmd: ['opencode', ...fullArgs].join(' '),
    eventPath,
    stdout,
    stderr,
  }));
}

function parseEvents(rawText) {
  const events = [];
  for (const line of String(rawText || '').split('\n')) {
    if (!line.trim()) continue;
    try { events.push(JSON.parse(line)); } catch {}
  }
  const sessionID = events.find((event) => event.sessionID)?.sessionID || null;
  const stepFinishes = events.filter((event) => event.type === 'step_finish' || event.part?.type === 'step-finish');
  const toolCalls = events.filter((event) => event.type === 'tool_use' || event.type === 'tool_call' || event.part?.type === 'tool' || event.part?.type === 'tool-invocation' || event.part?.type === 'tool-call');
  const outputText = events.filter((event) => event.type === 'text' || event.part?.type === 'text').map((event) => event.part?.text || event.text || '').join('\n');
  const tokens = stepFinishes.reduce((acc, event) => {
    const t = event.part?.tokens || event.tokens || {};
    acc.total += Number(t.total || 0);
    acc.input += Number(t.input || 0);
    acc.output += Number(t.output || 0);
    acc.reasoning += Number(t.reasoning || 0);
    acc.cacheRead += Number(t.cache?.read || 0);
    acc.cacheWrite += Number(t.cache?.write || 0);
    return acc;
  }, { total: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 });
  const cost = stepFinishes.reduce((sum, event) => sum + Number(event.part?.cost || event.cost || 0), 0);
  return { sessionID, eventCount: events.length, stepFinishCount: stepFinishes.length, toolCallCount: toolCalls.length, tokens, cost, textPreview: outputText.slice(0, 1800) };
}

function exportSession(sessionID, outPath) {
  if (!sessionID) return null;
  try {
    const stdout = execFileSync('opencode', ['export', sessionID], { encoding: 'utf8', maxBuffer: 1024 * 1024 * 20 });
    fs.writeFile(outPath, stdout);
    return outPath;
  } catch {
    return null;
  }
}

function aggregateExport(jsonText) {
  try {
    const data = JSON.parse(jsonText);
    const assistantMessages = (data.messages || []).filter((msg) => msg.info?.role === 'assistant');
    const tokens = assistantMessages.reduce((acc, msg) => {
      const t = msg.info?.tokens || {};
      acc.total += Number(t.total || 0);
      acc.input += Number(t.input || 0);
      acc.output += Number(t.output || 0);
      acc.reasoning += Number(t.reasoning || 0);
      acc.cacheRead += Number(t.cache?.read || 0);
      acc.cacheWrite += Number(t.cache?.write || 0);
      return acc;
    }, { total: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 });
    const cost = assistantMessages.reduce((sum, msg) => sum + Number(msg.info?.cost || 0), 0);
    const toolParts = (data.messages || []).flatMap((msg) => msg.parts || []).filter((part) => String(part.type || '').includes('tool'));
    return { tokens, cost, assistantMessageCount: assistantMessages.length, toolPartCount: toolParts.length };
  } catch {
    return null;
  }
}

function md(report) {
  const rows = report.runs.map((run) => `| ${run.name} | ${run.ok ? 'yes' : 'no'} | ${run.sessionID || 'n/a'} | ${run.durationMs} | ${run.telemetry.tokens.input} | ${run.telemetry.tokens.output} | ${run.telemetry.tokens.total} | ${run.telemetry.tokens.cacheRead} | ${run.telemetry.cost} | ${run.telemetry.toolCallCount} |`).join('\n');
  return `# OpenCode Provider Token Telemetry A/B

Date: ${report.generatedAt}

## Purpose

This is the first real provider-telemetry probe. It uses OpenCode's JSON events and session export token fields, not LocalQA's approximate token math.

## Evidence

- Evidence file: ${report.evidencePath}
- Evidence bytes: ${report.evidenceBytes}
- Evidence approx tokens: ${report.evidenceApproxTokens}

## Runs

| Run | OK | Session | Runtime ms | Input | Output | Total | Cache read | Cost | Tool calls |
|---|---:|---|---:|---:|---:|---:|---:|---:|---:|
${rows}

## Comparison

- Baseline input tokens: ${report.comparison.baselineInputTokens}
- LocalQA input tokens: ${report.comparison.localqaInputTokens}
- Input tokens saved: ${report.comparison.inputTokensSaved}
- Input reduction: ${report.comparison.inputReductionRatio}%
- Baseline total tokens: ${report.comparison.baselineTotalTokens}
- LocalQA total tokens: ${report.comparison.localqaTotalTokens}
- Total tokens saved: ${report.comparison.totalTokensSaved}
- Total reduction: ${report.comparison.totalReductionRatio}%

## Caveats

- This is one controlled provider telemetry A/B, not a statistically significant benchmark.
- The baseline attaches raw evidence directly to the model. A highly careful baseline agent could grep/read less, which is why the separate A/B proxy benchmark remains relevant.
- OpenCode reported cost as provided by the CLI. In this environment cost is $0.00 for these models even though token usage is recorded.
`;
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const evidence = await fs.readFile(EVIDENCE, 'utf8');
  const baselinePrompt = [
    'Using the attached Fastify OSS evidence only, produce compact JSON with keys: likely_files, test_commands, risks, next_reads.',
    'Do not call tools. Keep the answer under 220 words.',
  ].join(' ');
  const localqaPrompt = [
    'Use local_agent_run with controlMode=directed on this local file path:',
    EVIDENCE,
    'Task: produce compact JSON with keys likely_files, test_commands, risks, next_reads for a Fastify validation/error response behavior change.',
    'Use memory_query plus context_cleanup directed steps. Keep final answer under 220 words and include LocalQA tokenSavings if available.',
  ].join(' ');
  const baseline = await runOpenCode('baseline_raw_attachment_fastify', [baselinePrompt, '-f', EVIDENCE]);
  const localqa = await runOpenCode('localqa_directed_fastify', [localqaPrompt]);
  const runs = [];
  for (const run of [baseline, localqa]) {
    const telemetry = parseEvents(run.stdout);
    const exportPath = telemetry.sessionID ? path.join(OUT_DIR, `${run.name}-export.json`) : null;
    let exportAggregate = null;
    if (exportPath) {
      try {
        const exported = execFileSync('opencode', ['export', telemetry.sessionID], { encoding: 'utf8', maxBuffer: 1024 * 1024 * 30 });
        await fs.writeFile(exportPath, exported);
        exportAggregate = aggregateExport(exported);
      } catch {}
    }
    runs.push({
      name: run.name,
      ok: run.ok,
      status: run.status,
      durationMs: run.durationMs,
      sessionID: telemetry.sessionID,
      eventPath: run.eventPath,
      exportPath,
      telemetry,
      exportAggregate,
      stderrTail: run.stderr.slice(-2000),
    });
  }
  const baselineRun = runs[0];
  const localqaRun = runs[1];
  const inputTokensSaved = Math.max(0, baselineRun.telemetry.tokens.input - localqaRun.telemetry.tokens.input);
  const totalTokensSaved = Math.max(0, baselineRun.telemetry.tokens.total - localqaRun.telemetry.tokens.total);
  const comparison = {
    baselineInputTokens: baselineRun.telemetry.tokens.input,
    localqaInputTokens: localqaRun.telemetry.tokens.input,
    inputTokensSaved,
    inputReductionRatio: baselineRun.telemetry.tokens.input > 0 ? +((inputTokensSaved / baselineRun.telemetry.tokens.input) * 100).toFixed(2) : 0,
    baselineTotalTokens: baselineRun.telemetry.tokens.total,
    localqaTotalTokens: localqaRun.telemetry.tokens.total,
    totalTokensSaved,
    totalReductionRatio: baselineRun.telemetry.tokens.total > 0 ? +((totalTokensSaved / baselineRun.telemetry.tokens.total) * 100).toFixed(2) : 0,
  };
  const report = {
    ok: runs.every((run) => run.ok && run.sessionID),
    generatedAt: new Date().toISOString(),
    outDir: OUT_DIR,
    evidencePath: EVIDENCE,
    evidenceBytes: Buffer.byteLength(evidence),
    evidenceApproxTokens: approxTokens(evidence),
    runs,
    comparison,
  };
  await fs.writeFile(path.join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2));
  await fs.writeFile(path.join(OUT_DIR, 'OPENCODE_PROVIDER_TELEMETRY_AB.md'), md(report));
  console.log(JSON.stringify({ ok: report.ok, outDir: OUT_DIR, comparison, runs: runs.map((run) => ({ name: run.name, ok: run.ok, sessionID: run.sessionID, tokens: run.telemetry.tokens, cost: run.telemetry.cost, toolCallCount: run.telemetry.toolCallCount })) }, null, 2));
  if (!report.ok) process.exitCode = 1;
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err?.message || String(err), stack: String(err?.stack || '').split('\n').slice(0, 8).join('\n') }, null, 2));
  process.exitCode = 1;
});

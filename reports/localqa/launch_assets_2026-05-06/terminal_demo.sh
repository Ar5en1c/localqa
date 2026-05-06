#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"

echo "LocalQA v0.1 alpha"
echo "===================="
echo
echo "Local evidence + memory layer for frontier coding agents."
echo "Frontier model plans and implements. LocalQA collects, compresses, remembers, and verifies local evidence."
echo "Initial alpha uses Bonsai as the local worker model for evidence triage, cleanup, memory, and handoff prep."
echo

echo "1) One tool surface"
echo "-------------------"
echo "local_agent_run"
echo

echo "2) Launch check"
echo "---------------"
node - <<'NODE'
const fs = require('fs');
const path = require('path');
const base = './reports/localqa';
const dirs = fs.readdirSync(base)
  .filter((name) => name.startsWith('launch_check_'))
  .sort();
const latest = dirs.at(-1);
if (!latest) throw new Error('No launch_check report found');
const r = require(path.resolve(base, latest, 'report.json'));
console.log('launch_check_report:', latest);
console.log('launch_check_ok:', r.ok);
console.log('checks:', r.commands.map(c => `${c.name}=${c.ok ? 'pass' : 'fail'}`).join(', '));
NODE

echo

echo "3) Provider telemetry A/B"
echo "-------------------------"
node - <<'NODE'
const r = require('./reports/localqa/provider_telemetry_2026-05-05/report.json');
console.log('baseline_input_tokens:', r.comparison.baselineInputTokens);
console.log('localqa_input_tokens:', r.comparison.localqaInputTokens);
console.log('input_tokens_saved:', r.comparison.inputTokensSaved);
console.log('input_reduction:', `${r.comparison.inputReductionRatio}%`);
console.log('baseline_session:', r.runs[0].sessionID);
console.log('localqa_session:', r.runs[1].sessionID);
NODE

echo

echo "4) A/B proxy vs targeted normal-agent evidence"
echo "------------------------------------------------"
node - <<'NODE'
const r = require('./reports/localqa/ab_agent_workflows_2026-05-05/report.json');
console.log('baseline_tokens:', r.aggregate.baselineTokens);
console.log('localqa_tokens:', r.aggregate.localqaTokens);
console.log('saved_tokens:', r.aggregate.savedVsTargetedBaseline);
console.log('reduction:', `${r.aggregate.reductionVsTargetedBaseline}%`);
console.log('quality_pass:', `${r.aggregate.localqaPass}/${r.cases.length}`);
NODE

echo

echo "5) Long-horizon 300k simulation"
echo "--------------------------------"
node - <<'NODE'
const r = require('./reports/localqa/long_horizon_300k_2026-05-05/report.json');
console.log('raw_tokens:', r.aggregate.rawTokens);
console.log('compact_tokens:', r.aggregate.compactTokens);
console.log('saved_tokens:', r.aggregate.savedTokens);
console.log('reduction:', `${r.aggregate.reductionRatio}%`);
console.log('quality_pass:', `${r.aggregate.passCount}/${r.phases.length}`);
console.log('memory_written:', `${r.aggregate.memoryWrittenCount}/${r.phases.length}`);
NODE

echo

echo "Safe claim: LocalQA helps frontier coding agents use less context by collecting, compressing, remembering, and verifying local evidence before reasoning or implementation."
echo "Model split: Bonsai handles local evidence work; the frontier model remains responsible for planning and implementation."
echo "Caveat: It does not replace frontier models, intercept pasted cloud prompts, or prove patch correctness."

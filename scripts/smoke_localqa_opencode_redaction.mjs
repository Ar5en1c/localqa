#!/usr/bin/env node
import { execFileSync } from 'node:child_process';

const secret = 'sk-test-localqa-redaction-999';
const handoffPayload = {
  mode: 'handoff_gate',
  task: `Sensitive task API_KEY=${secret}`,
  text: `SYNTHETIC_ONLY API_KEY=${secret} token undefined`,
  destinationKind: 'main_llm',
  externalSendAttempted: true,
  sendPayloadKind: 'raw',
  contextBudgetTokens: 800,
};

const cleanupSecret = 'supersecret123';
const cleanupPayload = {
  mode: 'context_cleanup',
  task: `Fix this PASSWORD=${cleanupSecret}`,
  text: `ERROR login failed PASSWORD=${cleanupSecret}`,
  contextBudgetTokens: 800,
};

function runNode(script, input) {
  return execFileSync('node', [script], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function assertNoLeak(label, text) {
  if (String(text).includes(secret) || /API_KEY=sk-/i.test(String(text))) {
    throw new Error(`${label} leaked sensitive evidence`);
  }
}

const runnerRaw = runNode('scripts/localqa-opencode-runner.mjs', handoffPayload);
assertNoLeak('local_agent_run summary', runnerRaw);
const runner = JSON.parse(runnerRaw);
if (!runner.handle) throw new Error('local_agent_run did not return a vault handle');
if (runner.enforcement?.blocked !== true) throw new Error('raw external send was not blocked');

const queryRaw = runNode('scripts/localqa-vault-query.mjs', {
  handle: runner.handle,
  question: 'What actionable issue is present and is raw external send allowed?',
});
assertNoLeak('answer_from_handle output', queryRaw);
const query = JSON.parse(queryRaw);

const cleanupRaw = runNode('scripts/localqa-opencode-runner.mjs', cleanupPayload);
if (cleanupRaw.includes(cleanupSecret) || /PASSWORD=supersecret/i.test(cleanupRaw)) {
  throw new Error('non-handoff context cleanup leaked sensitive task or compact text');
}
const cleanup = JSON.parse(cleanupRaw);

console.log(JSON.stringify({
  ok: true,
  handle: runner.handle,
  runner: {
    selectedMode: runner.selectedMode,
    blocked: runner.enforcement?.blocked,
    allowedPayload: runner.enforcement?.allowedPayload,
    sensitive: runner.policy?.sensitive,
  },
  query: {
    ok: query.ok,
    answerContainsRedaction: String(query.answer || '').includes('[REDACTED]'),
  },
  nonHandoffCleanup: {
    selectedMode: cleanup.selectedMode,
    taskRedacted: String(cleanup.task || '').includes('[REDACTED]'),
    compactTextRedacted: String(cleanup.compactText || '').includes('[REDACTED]'),
  },
}, null, 2));

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { analyzeContextDump } from '../localqa/core/context-core.mjs';
import { inferLocalAgentModeForTest, runLocalAgentTask } from '../localqa/core/local-agent-core.mjs';

test('context cleanup does not inflate single-line DOM dumps', () => {
  const dom = `<main>${'<button class="x">Buy now</button><div data-noise="1">'.repeat(2200)}</main>`;
  const result = analyzeContextDump({
    task: 'Clean this DOM dump before sending to the main model.',
    text: dom,
    contextBudgetTokens: 600,
  });

  assert.equal(result.ok, true);
  assert.ok(result.output.chars < result.input.chars, `expected compact output, got ${result.output.chars} >= ${result.input.chars}`);
  assert.ok(result.tokenSavings.savedApproxTokens > 0);
  assert.ok(result.tokenSavings.reductionRatio > 50);
});

test('local agent routes stack traces to log_analysis from evidence content', async () => {
  const result = await runLocalAgentTask({
    task: 'Find the root cause and keep only actionable evidence.',
    text: [
      'TypeError: Cannot read properties of undefined',
      '    at runLogin (/repo/src/auth.ts:44:13)',
      '    at processTicksAndRejections (node:internal/process/task_queues:95:5)',
    ].join('\n'),
    useLocalPlanner: false,
  });

  assert.equal(result.ok, true);
  assert.equal(result.selectedMode, 'log_analysis');
  assert.ok(result.tokenSavings);
  assert.equal(result.telemetry.externalCalls, 0);
});

test('local agent routes multi-source docs tasks with a query to research', async () => {
  const mode = inferLocalAgentModeForTest({
    task: 'Research these docs and return source-backed guidance.',
    query: 'Playwright snapshots best practices',
    urls: [
      'https://example.com/docs/a',
      'https://example.com/docs/b',
    ],
  });

  assert.equal(mode, 'research');
});

test('local agent exposes handoff policy and savings on sensitive raw-send attempts', async () => {
  const outputDir = path.join(os.tmpdir(), `localqa-polish-${Date.now()}`);
  const result = await runLocalAgentTask({
    task: 'Prepare this auth debug dump before sending to the main model.',
    text: [
      'USER: kuldeep@example.com',
      'Authorization: Bearer abc123secret',
      'HTTP 422 /auth/v1/signup',
    ].join('\n'),
    destinationKind: 'main_llm',
    externalSendAttempted: true,
    sendPayloadKind: 'raw',
    outputDir,
    useLocalPlanner: false,
  });

  assert.equal(result.ok, true);
  assert.equal(result.selectedMode, 'handoff_gate');
  assert.equal(result.enforcement.blocked, true);
  assert.equal(result.policy.sensitive, true);
  assert.equal(result.policy.rawExternalSendAllowed, false);
  assert.ok(result.handoff.handoffProof.token);
  assert.ok(result.tokenSavings);
});

test('local agent reads local file paths without requiring pasted raw text', async () => {
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'localqa-file-input-'));
  const filePath = path.join(outputDir, 'error.log');
  await fs.writeFile(filePath, [
    'TypeError: Cannot read properties of undefined',
    '    at submitLogin (/repo/src/auth.ts:44:13)',
    '    at processTicksAndRejections (node:internal/process/task_queues:95:5)',
  ].join('\n'));

  const result = await runLocalAgentTask({
    task: 'Analyze this local error log without sending raw file content to the main model.',
    filePath,
    contextBudgetTokens: 500,
    useLocalPlanner: false,
  });

  assert.equal(result.ok, true);
  assert.equal(result.selectedMode, 'log_analysis');
  assert.equal(result.telemetry.localFileInputCount, 1);
  assert.ok(result.telemetry.localFileInputBytes > 0);
  assert.ok(result.tokenSavings);
});

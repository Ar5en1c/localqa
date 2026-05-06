#!/usr/bin/env node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const ROOT = process.cwd();

function runNodeScript(script, payload) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], {
      cwd: ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`${script} exited ${code}: ${stderr || stdout}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (err) {
        reject(new Error(`Unable to parse ${script} JSON: ${err?.message || err}\n${stdout}`));
      }
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'localqa-opencode-smoke-'));
const logPath = path.join(tmpDir, 'error.log');
await fs.writeFile(logPath, [
  'TypeError: Cannot read properties of undefined',
  '    at submitLogin (/repo/src/auth.ts:44:13)',
  'HTTP 401 POST http://localhost:3000/api/session',
].join('\n'));

const fileResult = await runNodeScript('scripts/localqa-opencode-runner.mjs', {
  task: 'Analyze this local file path without pasting raw evidence.',
  filePath: logPath,
  contextBudgetTokens: 500,
  useLocalPlanner: false,
});
assert(fileResult.ok === true, 'filePath runner failed');
assert(fileResult.selectedMode === 'log_analysis', `expected log_analysis, got ${fileResult.selectedMode}`);
assert(fileResult.telemetry?.localFileInputCount === 1, 'expected one local file input');

const handoffResult = await runNodeScript('scripts/localqa-opencode-runner.mjs', {
  task: 'Prepare this auth debug dump for main model handoff.',
  text: [
    'USER: kuldeep@example.com',
    'Authorization: Bearer abc123secret',
    'TypeError: Cannot read properties of undefined',
    'HTTP 401 POST http://localhost:3000/api/session',
  ].join('\n'),
  mode: 'handoff_gate',
  destinationKind: 'main_llm',
  externalSendAttempted: true,
  sendPayloadKind: 'raw',
  contextBudgetTokens: 500,
  useLocalPlanner: false,
});
assert(handoffResult.ok === true, 'handoff runner failed');
assert(handoffResult.handle?.startsWith('vault://'), 'expected vault handle from handoff');
assert(handoffResult.enforcement?.blocked === true, 'expected raw external send blocked');

const queryResult = await runNodeScript('scripts/localqa-vault-query.mjs', {
  handle: handoffResult.handle,
  question: 'What is the root cause and what sensitive data was detected?',
  contextBudgetTokens: 500,
});
assert(queryResult.ok === true, 'vault query failed');
assert(String(queryResult.answer || '').includes('TypeError') || String(queryResult.answer || '').includes('Authorization'), 'vault query did not return expected evidence');

console.log(JSON.stringify({
  ok: true,
  filePath: {
    selectedMode: fileResult.selectedMode,
    localFileInputCount: fileResult.telemetry.localFileInputCount,
    localFileInputBytes: fileResult.telemetry.localFileInputBytes,
  },
  handoff: {
    handle: handoffResult.handle,
    blocked: handoffResult.enforcement.blocked,
    allowedPayload: handoffResult.enforcement.allowedPayload,
    sensitive: handoffResult.policy?.sensitive ?? null,
  },
  vaultQuery: {
    handle: queryResult.handle,
    tokenSavings: queryResult.tokenSavings,
  },
}, null, 2));

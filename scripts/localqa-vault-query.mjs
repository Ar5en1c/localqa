#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { analyzeContextDump, redactSensitiveText } from '../localqa/core/context-core.mjs';

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

async function readInput() {
  const idx = process.argv.indexOf('--input-file');
  const file = idx >= 0 ? process.argv[idx + 1] : '';
  if (file) return fs.readFile(path.resolve(file), 'utf8');
  return readStdin();
}

function parseJson(text) {
  const raw = String(text || '').trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

function artifactIdFromHandle(value) {
  const handle = String(value || '').trim();
  if (!handle) return '';
  if (/^(vault|artifact):\/\//i.test(handle)) return handle.replace(/^(vault|artifact):\/\//i, '').replace(/[?#].*$/, '');
  if (/^localqa:\/\/context-index\//i.test(handle)) return handle.replace(/^localqa:\/\/context-index\//i, '').replace(/[?#].*$/, '');
  return handle;
}

async function pathExists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function resolveArtifactPath(args) {
  if (args.artifactPath) return path.resolve(args.artifactPath);
  const artifactId = artifactIdFromHandle(args.handle || args.artifactId);
  if (!artifactId) throw new Error('handle, artifactId, or artifactPath is required.');
  const candidates = [
    path.resolve('.opencode/vault', `${artifactId}.json`),
    path.resolve('.opencode/vault-runs', `${artifactId}.json`),
    path.resolve('reports/localqa/context-index', `${artifactId}.json`),
  ];
  for (const candidate of candidates) {
    if (await pathExists(candidate)) return candidate;
  }
  throw new Error(`No local artifact found for handle: ${args.handle || args.artifactId}`);
}

function compactArtifactMetadata(artifact, artifactPath) {
  return {
    artifactId: artifact.artifactId || path.basename(artifactPath, '.json'),
    artifactPath,
    createdAt: artifact.createdAt || null,
    sourceLabel: artifact.sourceLabel || null,
    task: redactSensitiveText(artifact.task || null),
    sensitivity: artifact.sensitivity || null,
    input: artifact.input || null,
    savings: artifact.savings || null,
    handoffProof: artifact.handoffProof || null,
  };
}

function artifactIsSensitive(artifact) {
  return Boolean(
    artifact?.sensitivity?.sensitive ||
    artifact?.policy?.sensitive ||
    artifact?.policy?.compactPayloadRedacted ||
    artifact?.handoff?.policy?.sensitive ||
    artifact?.handoff?.policy?.compactPayloadRedacted
  );
}

function safeArtifactSourceText(artifact, artifactPath) {
  const compact = artifact.compactPayload ||
    artifact.redactedCompactPayload ||
    artifact.output?.compactText ||
    artifact.analysis?.output?.compactText ||
    artifact.handoff?.compactPayload ||
    '';
  if (compact) return redactSensitiveText(compact);
  if (artifact.rawText) return redactSensitiveText(artifact.rawText);
  return JSON.stringify(compactArtifactMetadata(artifact, artifactPath), null, 2);
}

try {
  const args = parseJson(await readInput());
  const artifactPath = await resolveArtifactPath(args);
  const artifact = JSON.parse(await fs.readFile(artifactPath, 'utf8'));
  const question = String(args.question || args.task || 'Return the most relevant local evidence.').trim();
  const safeQuestion = redactSensitiveText(question);
  const sourceText = safeArtifactSourceText(artifact, artifactPath);
  const analysis = analyzeContextDump({
    mode: 'vault_query',
    task: safeQuestion,
    text: sourceText,
    sourceLabel: artifact.sourceLabel || artifact.artifactId || 'localqa-vault',
    contextBudgetTokens: Number.parseInt(args.contextBudgetTokens, 10) || 1200,
    maxLines: Number.parseInt(args.maxLines, 10) || 500,
  });
  console.log(JSON.stringify({
    ok: true,
    tool: 'answer_from_handle',
    handle: args.handle || `vault://${artifact.artifactId || path.basename(artifactPath, '.json')}`,
    question: safeQuestion,
    metadata: compactArtifactMetadata(artifact, artifactPath),
    answer: analysis.output.compactText,
    tokenSavings: analysis.tokenSavings,
    policy: artifact.policy || null,
  }, null, 2));
} catch (err) {
  console.log(JSON.stringify({
    ok: false,
    tool: 'answer_from_handle',
    error: err?.message || String(err),
  }, null, 2));
  process.exitCode = 1;
}

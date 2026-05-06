import fs from 'node:fs/promises';
import path from 'node:path';

import { runUiQa, summarizeForMcp } from './qa-core.mjs';
import { runSiteQa } from './site-core.mjs';
import { browserExtractPage, browserResearchTask } from './browser-agent-core.mjs';
import { analyzeContextDump, prepareLocalFirstHandoff } from './context-core.mjs';
import { appendProjectMemory, queryProjectMemory, recordWorkMemory } from './project-memory-core.mjs';

function trimText(value, max = 1000) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function hasTextInput(options) {
  return !!String(options.text || '').trim() || Array.isArray(options.chunks);
}

function evidenceText(options = {}) {
  if (String(options.text || '').trim()) return String(options.text || '');
  if (!Array.isArray(options.chunks)) return '';
  return options.chunks
    .map((chunk) => typeof chunk === 'string' ? chunk : `${chunk?.label || ''}\n${chunk?.text || ''}`)
    .join('\n\n');
}

function normalizeFileInputs(options = {}) {
  const inputs = [];
  if (options.filePath) {
    inputs.push({ path: String(options.filePath), label: options.sourceLabel || undefined });
  }
  if (Array.isArray(options.filePaths)) {
    for (const item of options.filePaths) {
      if (typeof item === 'string') inputs.push({ path: item });
      else if (item?.path) inputs.push({ path: String(item.path), label: item.label || undefined });
    }
  }
  return inputs.filter((item) => item.path.trim());
}

async function hydrateLocalFileInputs(options = {}) {
  const fileInputs = normalizeFileInputs(options);
  if (fileInputs.length === 0) return options;
  const maxBytesPerFile = Number.parseInt(options.maxFileBytes, 10) || 1_000_000;
  const loadedFiles = [];
  const fileChunks = [];
  for (const input of fileInputs) {
    const resolvedPath = path.resolve(input.path);
    const stat = await fs.stat(resolvedPath);
    if (!stat.isFile()) throw new Error(`LocalQA file input is not a file: ${resolvedPath}`);
    const buffer = await fs.readFile(resolvedPath);
    const truncated = buffer.byteLength > maxBytesPerFile;
    const text = buffer.subarray(0, maxBytesPerFile).toString('utf8');
    const label = input.label || path.basename(resolvedPath);
    fileChunks.push({
      label: `local-file:${label}`,
      text: truncated
        ? `${text}\n\n[LocalQA truncated file at ${maxBytesPerFile} bytes of ${buffer.byteLength} total bytes.]`
        : text,
    });
    loadedFiles.push({
      path: resolvedPath,
      label,
      bytes: buffer.byteLength,
      truncated,
      loadedBytes: Math.min(buffer.byteLength, maxBytesPerFile),
    });
  }
  return {
    ...options,
    chunks: [
      ...(Array.isArray(options.chunks) ? options.chunks : []),
      ...fileChunks,
    ],
    localFileInputs: loadedFiles,
  };
}

function isLocalEndpoint(endpoint) {
  if (!endpoint) return false;
  try {
    const parsed = new URL(endpoint);
    return ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function inferMode(options = {}) {
  const requestedMode = String(options.mode || 'auto').trim();
  if (requestedMode && requestedMode !== 'auto') return requestedMode;

  const task = `${options.task || ''} ${options.goal || ''} ${options.query || ''}`.toLowerCase();
  const evidence = evidenceText(options).slice(0, 12000).toLowerCase();
  if (hasTextInput(options)) {
    if (options.destinationKind || options.destinationUrl || /\b(send|handoff|server|external|main llm|cloud|upload)\b/.test(task)) {
      return 'handoff_gate';
    }
    if (
      /\b(log|stack trace|traceback|terminal|console|error output)\b/.test(task) ||
      /\b(typeerror|referenceerror|syntaxerror|traceback|stack trace|exception|fatal|panic)\b/.test(evidence) ||
      /\b(error|failed|failure)\b[\s\S]{0,160}\b(at\s+\S+|file ".*", line \d+|npm err|node:internal)\b/.test(evidence)
    ) return 'log_analysis';
    if (/\b(prompt|dump|context|compress|cleanup|clean up|dedupe)\b/.test(task)) return 'prompt_cleanup';
    return 'context_cleanup';
  }

  if (options.query || /\b(research|docs|documentation|source|search|compare|find online|look up)\b/.test(task)) {
    return 'research';
  }

  if (Array.isArray(options.urls) && options.urls.length > 1) {
    if (/\b(compare|difference|versus|vs)\b/.test(task)) return 'research';
    return 'site_qa';
  }

  if (options.url && /\b(extract|read page|summarize page|scrape|page text)\b/.test(task)) {
    return 'extract_page';
  }

  if (options.url && /\b(site|routes|crawl|multi-route|all pages|whole website)\b/.test(task)) {
    return 'site_qa';
  }

  if (options.url) return 'browser_qa';
  return 'context_cleanup';
}

export function inferLocalAgentModeForTest(options = {}) {
  return inferMode(options);
}

async function callLocalPlanner(options = {}) {
  const llm = options.llm;
  if (!llm?.enabled || !llm?.model || !isLocalEndpoint(llm.endpoint)) {
    return {
      used: false,
      reason: 'no local planner endpoint',
    };
  }

  const endpoint = llm.endpoint;
  const provider = llm.provider || 'openai-compatible';
  const prompt = [
    'You are the LocalQA MCP internal planner.',
    'Choose exactly one mode from: browser_qa, site_qa, research, extract_page, log_analysis, prompt_cleanup, context_cleanup, handoff_gate.',
    'Return raw JSON only with keys: mode, reason.',
    'Prefer browser_qa for testing one URL, site_qa for multiple routes, research for docs/search/source questions, handoff_gate before external/main-model handoff, and prompt_cleanup/log_analysis for raw text.',
    '',
    JSON.stringify({
      task: trimText(options.task || options.goal || options.query || '', 700),
      hasUrl: !!options.url,
      hasUrls: Array.isArray(options.urls) && options.urls.length > 0,
      urlCount: Array.isArray(options.urls) ? options.urls.length : 0,
      hasText: hasTextInput(options),
      destinationKind: options.destinationKind || null,
      destinationUrl: options.destinationUrl || null,
      textPreview: trimText(options.text || '', 700),
    }, null, 2),
  ].join('\n');

  try {
    const body = ['openai-compatible', 'llama-server', 'openai'].includes(provider)
      ? {
          model: llm.model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0,
          max_tokens: 80,
          response_format: { type: 'json_object' },
        }
      : {
          model: llm.model,
          messages: [{ role: 'user', content: prompt }],
          stream: false,
          think: false,
          format: 'json',
          options: { temperature: 0, num_predict: 80 },
        };
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(options.plannerTimeoutMs || 12000),
    });
    if (!res.ok) {
      return {
        used: true,
        ok: false,
        error: `${provider} planner HTTP ${res.status}`,
      };
    }
    const json = await res.json();
    const text = String(
      ['openai-compatible', 'llama-server', 'openai'].includes(provider)
        ? json.choices?.[0]?.message?.content || json.choices?.[0]?.text || ''
        : json.message?.content || json.response || '',
    ).trim();
    const parsed = JSON.parse(text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, ''));
    return {
      used: true,
      ok: true,
      provider,
      model: llm.model,
      mode: parsed.mode,
      reason: trimText(parsed.reason, 300),
    };
  } catch (err) {
    return {
      used: true,
      ok: false,
      error: err?.message || String(err),
    };
  }
}

function validateMode(mode, options = {}) {
  if (mode === 'browser_qa' && !options.url) return 'context_cleanup';
  if (mode === 'site_qa' && !options.url && !Array.isArray(options.urls)) return 'context_cleanup';
  if (mode === 'research' && !options.query && !options.url && !Array.isArray(options.urls)) return 'context_cleanup';
  if (mode === 'extract_page' && !options.url) return 'context_cleanup';
  if (['log_analysis', 'prompt_cleanup', 'context_cleanup', 'handoff_gate'].includes(mode) && !hasTextInput(options)) {
    if (options.url) return 'browser_qa';
    return 'context_cleanup';
  }
  return mode;
}

function toHandoffText(selectedMode, task, result) {
  const safeResult = result && typeof result === 'object'
    ? {
        mode: selectedMode,
        task,
        findings: Array.isArray(result.findings) ? result.findings.slice(0, 40) : undefined,
        findingCount: result.findingCount ?? (Array.isArray(result.findings) ? result.findings.length : undefined),
        llmSummary: result.llmSummary?.sanitized || result.llmSummary || undefined,
        tokenSavings: normalizeTokenSavings(result) || undefined,
        timings: result.timings || undefined,
        target: result.target || undefined,
      }
    : { mode: selectedMode, task, result };
  return JSON.stringify(safeResult, null, 2);
}

function normalizeTokenSavings(result) {
  if (!result || typeof result !== 'object') return null;
  const raw =
    result.tokenSavings?.rawEvidenceApproxTokens ??
    result.rawEvidenceApproxTokens ??
    result.input?.approxTokens ??
    result.analysis?.input?.approxTokens ??
    null;
  const compact =
    result.tokenSavings?.compactReportApproxTokens ??
    result.compactReportApproxTokens ??
    result.output?.approxTokens ??
    result.analysis?.output?.approxTokens ??
    result.tokenEstimate?.compactApproxTokens ??
    null;
  const saved =
    result.tokenSavings?.savedApproxTokens ??
    result.tokenSavings?.approxTokensSaved ??
    result.savings?.approxTokensSaved ??
    result.analysis?.savings?.approxTokensSaved ??
    (raw != null && compact != null ? Math.max(0, Number(raw) - Number(compact)) : null);
  const reduction =
    result.tokenSavings?.reductionRatio ??
    result.savings?.reductionRatio ??
    result.analysis?.savings?.reductionRatio ??
    (raw > 0 && compact != null ? Math.max(0, +((1 - Number(compact) / Number(raw)) * 100).toFixed(2)) : null);

  if (raw == null && compact == null && saved == null) return null;
  return {
    rawEvidenceApproxTokens: raw == null ? null : Number(raw),
    compactReportApproxTokens: compact == null ? null : Number(compact),
    savedApproxTokens: saved == null ? null : Number(saved),
    reductionRatio: reduction == null ? null : Number(reduction),
  };
}

function normalizeDirectedSteps(options = {}) {
  const rawSteps = Array.isArray(options.directedSteps) ? options.directedSteps : Array.isArray(options.steps) ? options.steps : [];
  return rawSteps
    .map((step, index) => ({
      ...step,
      index,
      tool: String(step?.tool || step?.mode || '').trim(),
      task: trimText(step?.task || step?.goal || options.task || options.goal || '', 1200),
    }))
    .filter((step) => step.tool);
}

function stepMode(tool) {
  const value = String(tool || '').trim();
  if (value === 'memory_query' || value === 'project_memory') return 'memory';
  if (value === 'memory_record' || value === 'record') return 'record_work';
  return value;
}

function summarizeStepOutput(step, result) {
  const compact =
    result?.result?.output?.compactText ||
    result?.result?.compactText ||
    result?.result?.compactPayload ||
    result?.result?.llmSummary?.sanitized ||
    result?.result?.compactText ||
    result?.compactText ||
    result?.handoff?.compactPayload ||
    '';
  return [
    `## Step ${step.index + 1}: ${step.tool}`,
    `Task: ${step.task || 'n/a'}`,
    `Mode: ${result?.selectedMode || stepMode(step.tool)}`,
    result?.ok === false ? `Status: failed` : 'Status: ok',
    result?.tokenSavings ? `Token savings: raw=${result.tokenSavings.rawEvidenceApproxTokens ?? 'n/a'} compact=${result.tokenSavings.compactReportApproxTokens ?? 'n/a'} saved=${result.tokenSavings.savedApproxTokens ?? 'n/a'} reduction=${result.tokenSavings.reductionRatio ?? 'n/a'}%` : '',
    compact ? trimText(compact, 1800) : '',
  ].filter(Boolean).join('\n');
}

function aggregateTokenSavings(results) {
  const savings = results.map((item) => item?.tokenSavings).filter(Boolean);
  if (!savings.length) return null;
  const raw = savings.reduce((sum, item) => sum + Number(item.rawEvidenceApproxTokens || 0), 0);
  const compact = savings.reduce((sum, item) => sum + Number(item.compactReportApproxTokens || 0), 0);
  const saved = Math.max(0, raw - compact);
  return {
    rawEvidenceApproxTokens: raw,
    compactReportApproxTokens: compact,
    savedApproxTokens: saved,
    reductionRatio: raw > 0 ? +((saved / raw) * 100).toFixed(2) : 0,
  };
}

async function runDirectedPlan(options = {}) {
  const startedAt = performance.now();
  const task = trimText(options.task || options.goal || 'Run directed LocalQA plan.', 1200);
  const controlMode = String(options.controlMode || (options.strict ? 'strict' : 'directed')).trim() || 'directed';
  const directedSteps = normalizeDirectedSteps(options);
  if (!directedSteps.length) {
    return {
      ok: false,
      tool: 'local_agent_run',
      agentType: 'local_mcp_agent',
      executionMode: 'local_first',
      controlMode,
      selectedMode: 'directed',
      task,
      error: 'Directed LocalQA execution requires directedSteps or steps.',
    };
  }

  const allowedTools = new Set([
    'browser_qa',
    'site_qa',
    'research',
    'extract_page',
    'log_analysis',
    'prompt_cleanup',
    'context_cleanup',
    'handoff_gate',
    'memory',
    'memory_query',
    'project_memory',
    'record_work',
    'memory_record',
    'record',
  ]);
  const results = [];
  const steps = [];
  for (const step of directedSteps) {
    if (controlMode === 'strict' && !allowedTools.has(step.tool)) {
      const failed = {
        ok: false,
        name: `directed_${step.index + 1}_${step.tool}`,
        durationMs: 0,
        error: `Tool is not allowed in strict LocalQA directed mode: ${step.tool}`,
      };
      steps.push(failed);
      results.push({ ok: false, selectedMode: step.tool, error: failed.error });
      continue;
    }
    const startedStep = performance.now();
    try {
      const mode = stepMode(step.tool);
      const childOptions = {
        ...options,
        ...step,
        mode,
        controlMode: 'auto',
        directedSteps: undefined,
        steps: undefined,
        recordMemory: false,
        task: step.task || task,
        contextBudgetTokens: step.contextBudgetTokens || options.contextBudgetTokens,
        outputDir: step.outputDir || options.outputDir,
        memoryDir: step.memoryDir || options.memoryDir,
      };
      const result = mode === 'memory'
        ? {
            ok: true,
            selectedMode: 'memory',
            result: await queryProjectMemory({ ...childOptions, question: step.question || step.query || step.task || task }),
            tokenSavings: null,
          }
        : mode === 'record_work'
          ? {
              ok: true,
              selectedMode: 'record_work',
              result: await recordWorkMemory(childOptions),
              tokenSavings: null,
            }
          : await runLocalAgentTask(childOptions);
      results.push(result);
      steps.push({
        ok: result.ok !== false,
        name: `directed_${step.index + 1}_${step.tool}`,
        durationMs: +(performance.now() - startedStep).toFixed(2),
        selectedMode: result.selectedMode || mode,
        error: result.error || undefined,
      });
    } catch (err) {
      const failed = {
        ok: false,
        name: `directed_${step.index + 1}_${step.tool}`,
        durationMs: +(performance.now() - startedStep).toFixed(2),
        error: err?.message || String(err),
      };
      steps.push(failed);
      results.push({ ok: false, selectedMode: step.tool, error: failed.error });
      if (controlMode === 'strict') break;
    }
  }

  const compactText = results.map((result, index) => summarizeStepOutput(directedSteps[index], result)).join('\n\n');
  const tokenSavings = aggregateTokenSavings(results);
  const outputContract = options.outputContract || {};
  const maxTokens = Number.parseInt(outputContract.maxTokens || options.contextBudgetTokens, 10);
  const contractedText = maxTokens > 0 && compactText.length > maxTokens * 4
    ? `${compactText.slice(0, Math.max(200, maxTokens * 4 - 80))}\n[LocalQA directed output truncated to outputContract.maxTokens=${maxTokens}]`
    : compactText;
  const output = {
    ok: steps.every((step) => step.ok),
    tool: 'local_agent_run',
    agentType: 'local_mcp_agent',
    executionMode: 'local_first',
    publicTool: 'local_agent_run',
    controlMode,
    selectedMode: 'directed',
    task,
    outputContract,
    steps,
    result: {
      ok: steps.every((step) => step.ok),
      mode: 'directed',
      stepCount: directedSteps.length,
      compactText: contractedText,
      stepResults: results.map((result, index) => ({
        index,
        tool: directedSteps[index]?.tool,
        selectedMode: result?.selectedMode || null,
        ok: result?.ok !== false,
        tokenSavings: result?.tokenSavings || null,
        handle: result?.handoff?.artifactId ? `vault://${result.handoff.artifactId}` : result?.result?.artifactId ? `vault://${result.result.artifactId}` : null,
        error: result?.error || null,
      })),
    },
    tokenSavings,
    telemetry: {
      internalStepCount: steps.length,
      externalCalls: 0,
      directedStepCount: directedSteps.length,
    },
    timings: {
      totalMs: +(performance.now() - startedAt).toFixed(2),
    },
  };
  if (options.recordMemory !== false) {
    output.memory = await appendProjectMemory({
      memoryDir: options.memoryDir,
      kind: 'directed_plan',
      controlMode,
      selectedMode: 'directed',
      ok: output.ok,
      task,
      summary: contractedText,
      tokenSavings,
      steps,
      tags: ['directed', 'localqa'],
      result: output,
    });
  }
  return output;
}

async function runStep(name, fn) {
  const startedAt = performance.now();
  try {
    const result = await fn();
    return {
      ok: true,
      name,
      durationMs: +(performance.now() - startedAt).toFixed(2),
      result,
    };
  } catch (err) {
    return {
      ok: false,
      name,
      durationMs: +(performance.now() - startedAt).toFixed(2),
      error: err?.message || String(err),
    };
  }
}

export async function runLocalAgentTask(options = {}) {
  options = await hydrateLocalFileInputs(options);
  const startedAt = performance.now();
  const task = trimText(options.task || options.goal || options.query || 'Run the requested LocalQA task.', 1200);
  const controlMode = String(options.controlMode || '').trim();
  if (controlMode === 'directed' || controlMode === 'strict' || Array.isArray(options.directedSteps)) {
    return runDirectedPlan({ ...options, task, controlMode: controlMode || 'directed' });
  }
  if (controlMode === 'memory' || ['memory', 'project_memory'].includes(String(options.mode || '').trim())) {
    const memoryResult = await queryProjectMemory({
      memoryDir: options.memoryDir,
      question: options.question || options.query || task,
      maxEntries: options.maxEntries,
      maxDays: options.maxDays,
    });
    return {
      ok: true,
      tool: 'local_agent_run',
      agentType: 'local_mcp_agent',
      executionMode: 'local_first',
      publicTool: 'local_agent_run',
      controlMode: 'memory',
      task,
      selectedMode: 'memory',
      steps: [{ ok: true, name: 'localqa_project_memory_query', durationMs: memoryResult.timings?.totalMs }],
      result: memoryResult,
      tokenSavings: memoryResult.tokenSavings,
      telemetry: {
        internalStepCount: 1,
        externalCalls: 0,
      },
      timings: {
        totalMs: +(performance.now() - startedAt).toFixed(2),
      },
    };
  }
  if (controlMode === 'record' || ['record', 'record_work'].includes(String(options.mode || '').trim())) {
    const recordResult = await recordWorkMemory({
      memoryDir: options.memoryDir,
      task,
      summary: options.summary,
      whatChanged: options.whatChanged,
      testsRun: options.testsRun,
      result: options.workResult || options.result,
      status: options.status,
      worked: options.worked,
      failed: options.failed,
      skipped: options.skipped,
      next: options.next,
      tags: options.tags,
    });
    return {
      ok: true,
      tool: 'local_agent_run',
      agentType: 'local_mcp_agent',
      executionMode: 'local_first',
      publicTool: 'local_agent_run',
      controlMode: 'record',
      task,
      selectedMode: 'record_work',
      steps: [{ ok: true, name: 'localqa_project_memory_record', durationMs: 0 }],
      result: recordResult,
      tokenSavings: null,
      telemetry: {
        internalStepCount: 1,
        externalCalls: 0,
      },
      timings: {
        totalMs: +(performance.now() - startedAt).toFixed(2),
      },
    };
  }
  const requestedMode = String(options.mode || 'auto').trim();
  const explicitMode = requestedMode && requestedMode !== 'auto' ? requestedMode : null;
  const heuristicMode = inferMode({ ...options, task });
  const planner = options.useLocalPlanner === false
    ? { used: false, reason: 'disabled' }
    : await callLocalPlanner({ ...options, task });
  const plannerMode = planner.ok ? planner.mode : null;
  const destinationRequested = !!options.destinationKind || !!options.destinationUrl;
  const policyRequiresHandoff = heuristicMode === 'handoff_gate' || destinationRequested;
  const selectedMode = explicitMode
    ? validateMode(explicitMode, options)
    : validateMode(policyRequiresHandoff ? 'handoff_gate' : (plannerMode || heuristicMode), options);
  const steps = [];

  const base = {
    ok: true,
    tool: 'local_agent_run',
    agentType: 'local_mcp_agent',
    executionMode: 'local_first',
    publicTool: 'local_agent_run',
    task,
    selectedMode,
    routing: {
      heuristicMode,
      planner,
      plannerMode,
      selectedMode,
      localFileInputs: options.localFileInputs?.map((item) => ({
        path: item.path,
        bytes: item.bytes,
        truncated: item.truncated,
        loadedBytes: item.loadedBytes,
      })) || [],
      note: explicitMode
        ? 'Explicit mode requested by caller; planner/heuristic suggestions were ignored except for deterministic mode validation.'
        : plannerMode && plannerMode !== heuristicMode
        ? policyRequiresHandoff
          ? 'Local planner suggested a different mode, but deterministic handoff policy forced handoff_gate.'
          : 'Local planner suggested a different mode; deterministic validation accepted or corrected it.'
        : 'Deterministic router and local planner were aligned or planner was unavailable.',
    },
  };

  if (selectedMode === 'browser_qa') {
    steps.push(await runStep('run_ui_qa', async () => summarizeForMcp(await runUiQa({
      url: options.url,
      goal: task,
      outputDir: options.outputDir,
      waitMs: options.waitMs,
      expectedText: options.expectedText,
      viewports: options.viewports,
      actions: options.actions,
      screenshot: options.screenshot,
      headless: options.headless,
      llm: options.llm,
    }))));
  } else if (selectedMode === 'site_qa') {
    steps.push(await runStep('run_site_qa', async () => runSiteQa({
      url: options.url,
      urls: options.urls,
      maxLinks: options.maxLinks,
      sameOrigin: options.sameOrigin,
      outputDir: options.outputDir,
      goal: task,
      waitMs: options.waitMs,
      expectedText: options.expectedText,
      viewports: options.viewports,
      screenshot: options.screenshot,
      headless: options.headless,
      actions: options.actions,
      llm: options.llm,
    })));
  } else if (selectedMode === 'research') {
    steps.push(await runStep('browser_research_task', async () => browserResearchTask({
      query: options.query || task,
      urls: options.urls || (options.url ? [options.url] : []),
      maxSources: options.maxSources,
      maxSnippets: options.maxSnippets,
      maxTextChars: options.maxTextChars || Math.max(1000, Math.min(Number.parseInt(options.contextBudgetTokens, 10) || 6000, 32000)) * 4,
      waitMs: options.waitMs,
    })));
  } else if (selectedMode === 'extract_page') {
    steps.push(await runStep('browser_extract_page', async () => browserExtractPage({
      url: options.url,
      waitMs: options.waitMs,
      outputDir: options.outputDir,
      screenshot: options.screenshot,
      viewport: options.viewport,
      maxTextChars: options.maxTextChars || Math.max(1000, Math.min(Number.parseInt(options.contextBudgetTokens, 10) || 6000, 32000)) * 4,
      maxLinks: options.maxLinks,
    })));
  } else if (selectedMode === 'handoff_gate') {
    steps.push(await runStep('localqa_prepare_handoff', async () => prepareLocalFirstHandoff({
      task,
      text: options.text,
      chunks: options.chunks,
      sourceLabel: options.sourceLabel,
      contextBudgetTokens: options.contextBudgetTokens,
      maxLines: options.maxLines,
      outputDir: options.outputDir,
      destinationKind: options.destinationKind,
      destinationUrl: options.destinationUrl,
      storeRaw: options.storeRaw,
      allowSensitiveCompact: options.allowSensitiveCompact,
    })));
  } else {
    steps.push(await runStep('localqa_cleanup_context', async () => analyzeContextDump({
      mode: selectedMode,
      task,
      text: options.text,
      chunks: options.chunks,
      sourceLabel: options.sourceLabel,
      contextBudgetTokens: options.contextBudgetTokens,
      maxLines: options.maxLines,
    })));
  }

  let autoHandoff = null;
  let finalStep = steps[steps.length - 1];
  const modeResult = finalStep?.result || null;
  if (destinationRequested && selectedMode !== 'handoff_gate' && options.autoRerouteHandoff !== false && finalStep?.ok) {
    const handoffStep = await runStep('localqa_prepare_handoff_auto', async () => prepareLocalFirstHandoff({
      task: `${task}\n\nAuto-reroute: destination policy requires local-first handoff envelope.`,
      text: toHandoffText(selectedMode, task, modeResult),
      sourceLabel: `local_agent_auto_${selectedMode}`,
      contextBudgetTokens: options.contextBudgetTokens,
      maxLines: options.maxLines,
      outputDir: options.outputDir,
      destinationKind: options.destinationKind,
      destinationUrl: options.destinationUrl,
      storeRaw: false,
      allowSensitiveCompact: options.allowSensitiveCompact,
    }));
    steps.push(handoffStep);
    if (handoffStep.ok) {
      autoHandoff = handoffStep.result;
      finalStep = handoffStep;
    }
  }

  const handoff = selectedMode === 'handoff_gate'
    ? steps.find((step) => step.name === 'localqa_prepare_handoff')?.result || finalStep?.result || null
    : autoHandoff;
  const handoffPolicy = handoff?.policy || null;
  const tokenSavings = normalizeTokenSavings(selectedMode === 'handoff_gate' ? handoff : modeResult) || normalizeTokenSavings(handoff);
  const externalSendAttempted = options.externalSendAttempted === true;
  const sendPayloadKind = options.sendPayloadKind || 'unknown';
  const rawSendBlocked = externalSendAttempted && (sendPayloadKind === 'raw' || sendPayloadKind === 'unknown') && handoffPolicy && !handoffPolicy.rawExternalSendAllowed;
  const compactSendBlocked = externalSendAttempted && sendPayloadKind === 'compact' && handoffPolicy && !handoffPolicy.compactExternalSendAllowed;
  const blocked = rawSendBlocked || compactSendBlocked;
  const allowedPayload = handoffPolicy
    ? handoffPolicy.rawExternalSendAllowed
      ? 'raw_or_compact'
      : handoffPolicy.compactExternalSendAllowed
        ? 'compact_only'
        : 'none'
    : 'unknown';
  const output = {
    ...base,
    ok: steps.every((step) => step.ok),
    steps: steps.map((step) => ({
      ok: step.ok,
      name: step.name,
      durationMs: step.durationMs,
      error: step.error || undefined,
    })),
    result: selectedMode === 'handoff_gate' ? (finalStep?.result || null) : modeResult,
    handoff,
    policy: handoffPolicy,
    tokenSavings,
    enforcement: {
      requiresMcpFirst: true,
      destinationRequested,
      autoReroutedToHandoffGate: !!autoHandoff,
      externalSendAttempted,
      sendPayloadKind,
      blocked,
      allowedPayload,
      reason: blocked
        ? rawSendBlocked
          ? 'Raw external send blocked by local-first policy. Use compactPayload from handoff result.'
          : 'Compact external send blocked by local-first policy. User approval or policy override required.'
        : handoffPolicy
          ? 'Local-first handoff policy evaluated. Follow allowedPayload before any external send.'
          : 'No external destination requested.',
      handoffVerificationRequired: !!handoff?.handoffProof,
      handoffProof: handoff?.handoffProof || null,
    },
    telemetry: {
      internalStepCount: steps.length,
      externalCalls: 0,
      localFileInputCount: options.localFileInputs?.length || 0,
      localFileInputBytes: (options.localFileInputs || []).reduce((sum, item) => sum + item.loadedBytes, 0),
    },
    timings: {
      totalMs: +(performance.now() - startedAt).toFixed(2),
    },
  };
  if (options.recordMemory !== false) {
    output.memory = await appendProjectMemory({
      memoryDir: options.memoryDir,
      kind: 'local_agent_run',
      controlMode: controlMode || 'auto',
      selectedMode,
      ok: output.ok,
      task,
      summary: output.result?.output?.compactText || output.result?.compactPayload || output.result?.llmSummary?.sanitized || '',
      tokenSavings,
      artifactHandles: handoff?.artifactId ? [`vault://${handoff.artifactId}`] : [],
      steps: output.steps,
      tags: ['localqa', selectedMode],
      result: output,
    });
  }
  return output;
}

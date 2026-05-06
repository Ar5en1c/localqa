#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { runUiQa, summarizeForMcp } from './core/qa-core.mjs';
import { discoverSiteLinks, runSiteQa } from './core/site-core.mjs';
import {
  browserAct,
  browserEndSession,
  browserExtractPage,
  browserResearchTask,
  browserSearch,
  browserSnapshot,
  browserStartSession,
  listBrowserSessions,
} from './core/browser-agent-core.mjs';
import { analyzeContextDump, prepareLocalFirstHandoff, verifyLocalFirstHandoff } from './core/context-core.mjs';
import { runLocalAgentTask } from './core/local-agent-core.mjs';

const SERVER_INFO = {
  name: 'localqa',
  version: '0.2.0',
};

const DEFAULT_BONSAI_LLM = {
  provider: 'openai-compatible',
  model: 'Bonsai-8B.gguf',
  endpoint: 'http://127.0.0.1:18081/v1/chat/completions',
  timeoutMs: 60000,
  maxTokens: 256,
  temperature: 0.5,
  topK: 20,
  topP: 0.85,
};
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
let bonsaiServerProcess = null;
let bonsaiStartupPromise = null;
let bonsaiServerLastExit = null;

const ViewportSchema = z.object({
  name: z.string().optional(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

const ActionSchema = z.object({
  type: z.enum(['click', 'fill', 'press', 'select', 'check', 'uncheck', 'wait', 'wait_for_text', 'assert_text']),
  selector: z.string().optional(),
  value: z.string().optional(),
  text: z.string().optional(),
  key: z.string().optional(),
  timeoutMs: z.number().int().positive().optional(),
  waitAfterMs: z.number().int().nonnegative().optional(),
});

const BrowserActionSchema = z.object({
  type: z.enum(['goto', 'click', 'fill', 'press', 'select', 'check', 'uncheck', 'wait', 'wait_for_text', 'assert_text']),
  selector: z.string().optional(),
  value: z.string().optional(),
  text: z.string().optional(),
  key: z.string().optional(),
  timeoutMs: z.number().int().positive().optional(),
  waitAfterMs: z.number().int().nonnegative().optional(),
});

const LocalTaskModeSchema = z.enum([
  'auto',
  'browser_qa',
  'site_qa',
  'research',
  'extract_page',
  'log_analysis',
  'prompt_cleanup',
  'context_cleanup',
  'handoff_gate',
]);

const PUBLIC_SURFACE = String(process.env.LOCALQA_PUBLIC_SURFACE || 'agent-strict').toLowerCase();
const AGENT_SURFACE_TOOLS = new Set(['local_agent_run', 'localqa_health', 'read_qa_report', 'localqa_verify_handoff']);
const STRICT_AGENT_SURFACE_TOOLS = new Set(['local_agent_run']);

function resolveTaskGoal(args) {
  return String(args.task || args.goal || '').trim();
}

function budgetToMaxTextChars(args, fallbackTokens = 6000) {
  const tokens = Number.parseInt(args.contextBudgetTokens, 10) || fallbackTokens;
  return Math.max(1000, Math.min(tokens, 32000)) * 4;
}

function buildLlmOptions(args) {
  const defaultToBonsai = String(process.env.LOCALQA_DEFAULT_LLM || '').toLowerCase() === 'bonsai';
  const model = args.llmModel || args.ollamaModel || process.env.LOCALQA_LLM_MODEL || (defaultToBonsai ? DEFAULT_BONSAI_LLM.model : '');
  if (!model) return null;
  const endpoint = args.llmEndpoint || process.env.LOCALQA_LLM_ENDPOINT || (defaultToBonsai ? DEFAULT_BONSAI_LLM.endpoint : undefined);
  const provider = args.llmProvider ||
    process.env.LOCALQA_LLM_PROVIDER ||
    (args.ollamaModel ? 'ollama' : endpoint ? DEFAULT_BONSAI_LLM.provider : 'ollama');
  return {
    enabled: true,
    provider,
    model,
    endpoint,
    timeoutMs: args.llmTimeoutMs || args.ollamaTimeoutMs || (defaultToBonsai ? DEFAULT_BONSAI_LLM.timeoutMs : undefined),
    maxTokens: args.llmMaxTokens || args.ollamaMaxTokens || (defaultToBonsai ? DEFAULT_BONSAI_LLM.maxTokens : undefined),
    temperature: args.llmTemperature ?? (defaultToBonsai ? DEFAULT_BONSAI_LLM.temperature : undefined),
    topK: args.llmTopK ?? (defaultToBonsai ? DEFAULT_BONSAI_LLM.topK : undefined),
    topP: args.llmTopP ?? (defaultToBonsai ? DEFAULT_BONSAI_LLM.topP : undefined),
  };
}

function jsonText(value) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

function deriveOpenAiModelsEndpoint(endpoint) {
  const value = String(endpoint || '').trim();
  if (!value) return '';
  if (/\/v1\/models\/?$/i.test(value)) return value;
  if (/\/v1\/chat\/completions\/?$/i.test(value)) {
    return value.replace(/\/v1\/chat\/completions\/?$/i, '/v1/models');
  }
  return value.replace(/\/+$/, '') + '/v1/models';
}

async function probeJsonEndpoint(url, timeoutMs = 1500) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    const text = await res.text();
    return {
      ok: res.ok,
      status: res.status,
      text,
    };
  } catch (err) {
    return {
      ok: false,
      error: err?.message || String(err),
    };
  }
}

async function waitForEndpoint(url, timeoutMs = 30000) {
  const startedAt = performance.now();
  let last = null;
  while (performance.now() - startedAt < timeoutMs) {
    last = await probeJsonEndpoint(url, 1500);
    if (last.ok) return last;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return last || { ok: false, error: 'endpoint wait timed out' };
}

function shouldAutostartBonsai() {
  const explicit = String(process.env.LOCALQA_BONSAI_AUTOSTART || '').toLowerCase();
  if (['0', 'false', 'off', 'no'].includes(explicit)) return false;
  if (['1', 'true', 'on', 'yes'].includes(explicit)) return true;
  return String(process.env.LOCALQA_DEFAULT_LLM || '').toLowerCase() === 'bonsai';
}

async function ensureBonsaiServer() {
  if (bonsaiStartupPromise) return bonsaiStartupPromise;
  bonsaiStartupPromise = (async () => {
    if (!shouldAutostartBonsai()) {
      return {
        attempted: false,
        reason: 'LOCALQA_BONSAI_AUTOSTART disabled',
      };
    }

    const endpoint = process.env.LOCALQA_LLM_ENDPOINT || DEFAULT_BONSAI_LLM.endpoint;
    const modelsEndpoint = deriveOpenAiModelsEndpoint(endpoint);
    const existing = await probeJsonEndpoint(modelsEndpoint, 1000);
    if (existing.ok) {
      return {
        attempted: false,
        ok: true,
        alreadyRunning: true,
        endpoint: modelsEndpoint,
      };
    }

    const scriptPath = path.join(REPO_ROOT, 'scripts/start_bonsai_llama_server.sh');
    try {
      await fs.access(scriptPath);
    } catch {
      return {
        attempted: true,
        ok: false,
        endpoint: modelsEndpoint,
        error: `Missing Bonsai start script: ${scriptPath}`,
      };
    }

    const preSpawnProbe = await probeJsonEndpoint(modelsEndpoint, 600);
    if (preSpawnProbe.ok) {
      return {
        attempted: false,
        ok: true,
        alreadyRunning: true,
        endpoint: modelsEndpoint,
      };
    }

    bonsaiServerProcess = spawn('bash', [scriptPath], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        BONSAI_HOST: process.env.BONSAI_HOST || '127.0.0.1',
        BONSAI_PORT: process.env.BONSAI_PORT || '18081',
      },
      stdio: ['ignore', 'ignore', 'pipe'],
      detached: false,
    });
    const spawnedPid = bonsaiServerProcess?.pid || null;
    let stderrPreview = '';
    bonsaiServerProcess.stderr?.on('data', (chunk) => {
      stderrPreview = `${stderrPreview}${String(chunk)}`.slice(-2000);
    });
    bonsaiServerProcess.on('exit', (code, signal) => {
      if (bonsaiServerProcess?.pid === spawnedPid) bonsaiServerProcess = null;
      if (code && code !== 0) {
        bonsaiServerLastExit = {
          code,
          signal: signal || '',
          at: new Date().toISOString(),
          pid: spawnedPid,
        };
      }
    });
    bonsaiServerProcess.unref?.();

    const ready = await waitForEndpoint(modelsEndpoint, Number.parseInt(process.env.LOCALQA_BONSAI_START_TIMEOUT_MS, 10) || 30000);
    return {
      attempted: true,
      ok: ready.ok,
      alreadyRunning: false,
      endpoint: modelsEndpoint,
      pid: spawnedPid,
      error: ready.ok ? null : [
        ready.error,
        bonsaiServerLastExit ? `last_exit=code:${bonsaiServerLastExit.code},signal:${bonsaiServerLastExit.signal},pid:${bonsaiServerLastExit.pid},at:${bonsaiServerLastExit.at}` : null,
        stderrPreview || null,
      ].filter(Boolean).join(' | ') || 'Bonsai server did not become ready',
    };
  })();
  try {
    return await bonsaiStartupPromise;
  } finally {
    bonsaiStartupPromise = null;
  }
}

process.once('exit', () => {
  if (bonsaiServerProcess?.pid) {
    try {
      bonsaiServerProcess.kill();
    } catch {
      // best-effort cleanup
    }
  }
});

async function getHealth(options = {}) {
  const ollamaEndpoint = options.ollamaEndpoint || 'http://127.0.0.1:11434/api/tags';
  const health = {
    ok: true,
    playwright: { ok: false },
    ollama: { ok: false },
    localLlm: null,
  };

  try {
    await import('playwright');
    health.playwright = { ok: true };
  } catch (err) {
    health.ok = false;
    health.playwright = { ok: false, error: err?.message || String(err) };
  }

  try {
    const res = await fetch(ollamaEndpoint);
    const text = await res.text();
    health.ollama = {
      ok: res.ok,
      status: res.status,
      preview: text.slice(0, 500),
    };
  } catch (err) {
    health.ollama = { ok: false, error: err?.message || String(err) };
  }

  if (options.llmEndpoint) {
    const modelsEndpoint = deriveOpenAiModelsEndpoint(options.llmEndpoint);
    try {
      const res = await fetch(modelsEndpoint);
      const text = await res.text();
      let parsed = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
      const ids = Array.isArray(parsed?.data)
        ? parsed.data.map((model) => model.id || model.name).filter(Boolean)
        : Array.isArray(parsed?.models)
          ? parsed.models.map((model) => model.id || model.name || model.model).filter(Boolean)
          : [];
      const requestedModel = options.llmModel || '';
      const modelFound = requestedModel ? ids.includes(requestedModel) || ids.some((id) => String(id).includes(requestedModel)) : null;
      health.localLlm = {
        ok: res.ok && (modelFound !== false),
        provider: options.llmProvider || 'openai-compatible',
        endpoint: modelsEndpoint,
        status: res.status,
        requestedModel: requestedModel || null,
        modelFound,
        models: ids.slice(0, 20),
        preview: text.slice(0, 500),
      };
      if (!health.localLlm.ok) health.ok = false;
    } catch (err) {
      health.ok = false;
      health.localLlm = {
        ok: false,
        provider: options.llmProvider || 'openai-compatible',
        endpoint: modelsEndpoint,
        requestedModel: options.llmModel || null,
        error: err?.message || String(err),
      };
    }
  }

  if (!options.llmEndpoint && String(process.env.LOCALQA_DEFAULT_LLM || '').toLowerCase() === 'bonsai') {
    const modelsEndpoint = deriveOpenAiModelsEndpoint(process.env.LOCALQA_LLM_ENDPOINT || DEFAULT_BONSAI_LLM.endpoint);
    const probe = await probeJsonEndpoint(modelsEndpoint, 1500);
    health.localLlm = {
      ok: probe.ok,
      provider: process.env.LOCALQA_LLM_PROVIDER || DEFAULT_BONSAI_LLM.provider,
      endpoint: modelsEndpoint,
      requestedModel: process.env.LOCALQA_LLM_MODEL || DEFAULT_BONSAI_LLM.model,
      status: probe.status || null,
      preview: String(probe.text || probe.error || '').slice(0, 500),
      autostart: {
        enabled: shouldAutostartBonsai(),
        processPid: bonsaiServerProcess?.pid || null,
      },
    };
    if (!probe.ok) health.ok = false;
  }

  return health;
}

const server = new McpServer(SERVER_INFO);
const registerTool = server.registerTool.bind(server);
server.registerTool = (name, ...args) => {
  if (PUBLIC_SURFACE === 'agent' && !AGENT_SURFACE_TOOLS.has(name)) return undefined;
  if (PUBLIC_SURFACE === 'agent-strict' && !STRICT_AGENT_SURFACE_TOOLS.has(name)) return undefined;
  return registerTool(name, ...args);
};

server.registerTool(
  'local_agent_run',
  {
    title: 'Run local agent',
    description: [
      'PRIMARY PUBLIC TOOL: this is a local MCP sub-agent, not a simple helper.',
      'The main agent should call this once with the exact task and evidence, then wait for LocalQA to choose and run internal tools locally.',
      'Internal capabilities include browser QA, multi-route site QA, page extraction, coding/web research, log analysis, prompt cleanup, context cleanup, local-first handoff gating, Playwright actions, screenshots, network/console collection, Bonsai local-model triage, and deterministic claim verification.',
      'Prompt contract for the main agent: provide task, url or urls when browser work is needed, text or chunks when cleaning logs/context, expectedText/actions/viewports when relevant, and destinationKind/destinationUrl when any output may be sent to a main LLM or external server.',
      'Do not paste raw DOM/log/browser dumps into another model first; send them here so the local agent can index, compact, redact, and return a safe compact result.',
    ].join(' '),
    inputSchema: {
      mode: LocalTaskModeSchema.optional(),
      useLocalPlanner: z.boolean().optional(),
      plannerTimeoutMs: z.number().int().positive().optional(),
      url: z.string().url().optional().describe('Target URL for browser QA, extraction, or research.'),
      urls: z.array(z.string().url()).optional().describe('Multiple URLs for site QA or source comparison/research.'),
      text: z.string().optional().describe('Raw logs, DOM dumps, prompt dumps, browser evidence, or other context to clean locally before any server handoff.'),
      chunks: z.array(z.object({
        label: z.string().optional(),
        text: z.string(),
      })).optional().describe('Labeled raw context chunks to clean/index locally.'),
      filePath: z.string().optional().describe('Local file path to read inside LocalQA. Use this instead of pasting large logs or dumps into cloud chat.'),
      filePaths: z.array(z.union([
        z.string(),
        z.object({
          path: z.string(),
          label: z.string().optional(),
        }),
      ])).optional().describe('Local file paths to read inside LocalQA as labeled chunks.'),
      maxFileBytes: z.number().int().positive().optional().describe('Maximum bytes to read per local file input. Defaults to 1,000,000.'),
      sourceLabel: z.string().optional(),
      task: z.string().optional().describe('Exact instruction for the local agent. Include what to test, what to verify, and what not to overclaim.'),
      goal: z.string().optional(),
      query: z.string().optional(),
      contextBudgetTokens: z.number().int().positive().optional().describe('Maximum compact context budget for local cleanup/handoff.'),
      maxLines: z.number().int().positive().optional(),
      outputDir: z.string().optional(),
      destinationKind: z.enum(['main_llm', 'external_server', 'local_server', 'unknown']).optional().describe('Where the compact result may be sent. Use this to trigger local-first handoff policy.'),
      destinationUrl: z.string().optional().describe('Destination endpoint if context may be sent to another server/model.'),
      storeRaw: z.boolean().optional(),
      allowSensitiveCompact: z.boolean().optional(),
      autoRerouteHandoff: z.boolean().optional().describe('When destinationKind/destinationUrl is set, auto-prepare a handoff envelope from tool results before any external send. Default true.'),
      externalSendAttempted: z.boolean().optional().describe('Set true when the host/main agent is about to send output to an external model/server now.'),
      sendPayloadKind: z.enum(['raw', 'compact', 'unknown']).optional().describe('Payload planned for external send. Used by local policy blocker.'),
      allowUnsafeExternalSend: z.boolean().optional(),
      waitMs: z.number().int().nonnegative().optional(),
      maxLinks: z.number().int().positive().optional(),
      maxSources: z.number().int().positive().optional(),
      maxSnippets: z.number().int().positive().optional(),
      maxTextChars: z.number().int().positive().optional(),
      sameOrigin: z.boolean().optional(),
      expectedText: z.array(z.string()).optional(),
      viewports: z.array(ViewportSchema).optional(),
      viewport: ViewportSchema.optional(),
      screenshot: z.boolean().optional(),
      headless: z.boolean().optional(),
      actions: z.array(ActionSchema).optional(),
      llmProvider: z.enum(['ollama', 'openai-compatible', 'llama-server', 'openai']).optional(),
      llmModel: z.string().optional(),
      llmEndpoint: z.string().url().optional(),
      llmTimeoutMs: z.number().int().positive().optional(),
      llmMaxTokens: z.number().int().positive().optional(),
      llmTemperature: z.number().nonnegative().optional(),
      llmTopK: z.number().int().nonnegative().optional(),
      llmTopP: z.number().nonnegative().optional(),
    },
  },
  async (args) => jsonText(await runLocalAgentTask({
    ...args,
    task: resolveTaskGoal(args) || args.query || 'Run the requested LocalQA task.',
    llm: buildLlmOptions(args),
  })),
);

server.registerTool(
  'localqa_run_task',
  {
    title: 'Run LocalQA task',
    description: [
      'High-level LocalQA facade for coding agents.',
      'Use this first to delegate browser QA, site QA, source-backed research, or page extraction in one MCP call.',
      'LocalQA handles Playwright/data collection internally and returns compact evidence instead of raw browser dumps.',
    ].join(' '),
    inputSchema: {
      mode: LocalTaskModeSchema.optional(),
      url: z.string().url().optional(),
      urls: z.array(z.string().url()).optional(),
      text: z.string().optional(),
      chunks: z.array(z.object({
        label: z.string().optional(),
        text: z.string(),
      })).optional(),
      sourceLabel: z.string().optional(),
      task: z.string().optional(),
      goal: z.string().optional(),
      query: z.string().optional(),
      contextBudgetTokens: z.number().int().positive().optional(),
      maxLines: z.number().int().positive().optional(),
      outputDir: z.string().optional(),
      destinationKind: z.enum(['main_llm', 'external_server', 'local_server', 'unknown']).optional(),
      destinationUrl: z.string().optional(),
      storeRaw: z.boolean().optional(),
      allowSensitiveCompact: z.boolean().optional(),
      waitMs: z.number().int().nonnegative().optional(),
      maxLinks: z.number().int().positive().optional(),
      sameOrigin: z.boolean().optional(),
      expectedText: z.array(z.string()).optional(),
      viewports: z.array(ViewportSchema).optional(),
      screenshot: z.boolean().optional(),
      headless: z.boolean().optional(),
      actions: z.array(ActionSchema).optional(),
      ollamaModel: z.string().optional(),
      ollamaTimeoutMs: z.number().int().positive().optional(),
      ollamaMaxTokens: z.number().int().positive().optional(),
      llmProvider: z.enum(['ollama', 'openai-compatible', 'llama-server', 'openai']).optional(),
      llmModel: z.string().optional(),
      llmEndpoint: z.string().url().optional(),
      llmTimeoutMs: z.number().int().positive().optional(),
      llmMaxTokens: z.number().int().positive().optional(),
      llmTemperature: z.number().nonnegative().optional(),
      llmTopK: z.number().int().nonnegative().optional(),
      llmTopP: z.number().nonnegative().optional(),
    },
  },
  async (args) => {
    const requestedMode = args.mode || (args.query ? 'research' : 'browser_qa');
    const task = resolveTaskGoal(args) || args.query || 'Run the requested local assistant task.';
    const envelope = {
      ok: true,
      tool: 'localqa_run_task',
      mode: requestedMode,
      task,
      contextBudgetTokens: args.contextBudgetTokens || null,
      localLlm: args.llmModel || args.ollamaModel || null,
      note: 'This is the public one-call facade. Lower-level LocalQA tools remain available for debugging and advanced workflows.',
    };

    if (requestedMode === 'browser_qa') {
      if (!args.url) throw new Error('localqa_run_task mode=browser_qa requires url');
      const report = await runUiQa({
        url: args.url,
        goal: task,
        outputDir: args.outputDir,
        waitMs: args.waitMs,
        expectedText: args.expectedText,
        viewports: args.viewports,
        actions: args.actions,
        screenshot: args.screenshot,
        headless: args.headless,
        llm: buildLlmOptions(args),
      });
      return jsonText({
        ...envelope,
        result: summarizeForMcp(report),
      });
    }

    if (requestedMode === 'site_qa') {
      if (!args.url && !Array.isArray(args.urls)) throw new Error('localqa_run_task mode=site_qa requires url or urls');
      const report = await runSiteQa({
        url: args.url,
        urls: args.urls,
        maxLinks: args.maxLinks,
        sameOrigin: args.sameOrigin,
        outputDir: args.outputDir,
        goal: task,
        waitMs: args.waitMs,
        expectedText: args.expectedText,
        viewports: args.viewports,
        screenshot: args.screenshot,
        headless: args.headless,
        actions: args.actions,
        llm: buildLlmOptions(args),
      });
      return jsonText({
        ...envelope,
        result: report,
      });
    }

    if (requestedMode === 'research') {
      const query = String(args.query || task).trim();
      if (!query) throw new Error('localqa_run_task mode=research requires query or task');
      const report = await browserResearchTask({
        query,
        urls: args.urls || (args.url ? [args.url] : []),
        maxTextChars: budgetToMaxTextChars(args),
        headless: args.headless,
      });
      return jsonText({
        ...envelope,
        result: report,
      });
    }

    if (requestedMode === 'extract_page') {
      if (!args.url) throw new Error('localqa_run_task mode=extract_page requires url');
      const report = await browserExtractPage({
        url: args.url,
        maxTextChars: budgetToMaxTextChars(args),
        screenshot: args.screenshot,
        headless: args.headless,
      });
      return jsonText({
        ...envelope,
        result: report,
      });
    }

    if (['log_analysis', 'prompt_cleanup', 'context_cleanup'].includes(requestedMode)) {
      if (!args.text && !Array.isArray(args.chunks)) {
        throw new Error(`localqa_run_task mode=${requestedMode} requires text or chunks`);
      }
      const report = analyzeContextDump({
        mode: requestedMode,
        task,
        text: args.text,
        chunks: args.chunks,
        sourceLabel: args.sourceLabel,
        contextBudgetTokens: args.contextBudgetTokens,
        maxLines: args.maxLines,
      });
      return jsonText({
        ...envelope,
        result: report,
      });
    }

    if (requestedMode === 'handoff_gate') {
      if (!args.text && !Array.isArray(args.chunks)) {
        throw new Error('localqa_run_task mode=handoff_gate requires text or chunks');
      }
      const report = await prepareLocalFirstHandoff({
        task,
        text: args.text,
        chunks: args.chunks,
        sourceLabel: args.sourceLabel,
        contextBudgetTokens: args.contextBudgetTokens,
        maxLines: args.maxLines,
        outputDir: args.outputDir,
        destinationKind: args.destinationKind,
        destinationUrl: args.destinationUrl,
        storeRaw: args.storeRaw,
        allowSensitiveCompact: args.allowSensitiveCompact,
      });
      return jsonText({
        ...envelope,
        result: report,
      });
    }

    throw new Error(`Unsupported localqa_run_task mode: ${requestedMode}`);
  },
);

server.registerTool(
  'localqa_prepare_handoff',
  {
    title: 'Prepare local-first handoff',
    description: [
      'Use before sending raw logs, DOM dumps, browser evidence, repo snippets, or prompt dumps to any larger/external model.',
      'Creates a local artifact, compacts the payload, flags sensitive data, and returns a policy for what is safe to send.',
    ].join(' '),
    inputSchema: {
      text: z.string().optional(),
      chunks: z.array(z.object({
        label: z.string().optional(),
        text: z.string(),
      })).optional(),
      task: z.string().optional(),
      goal: z.string().optional(),
      sourceLabel: z.string().optional(),
      contextBudgetTokens: z.number().int().positive().optional(),
      maxLines: z.number().int().positive().optional(),
      outputDir: z.string().optional(),
      destinationKind: z.enum(['main_llm', 'external_server', 'local_server', 'unknown']).optional(),
      destinationUrl: z.string().optional(),
      storeRaw: z.boolean().optional(),
      allowSensitiveCompact: z.boolean().optional(),
    },
  },
  async (args) => {
    if (!args.text && !Array.isArray(args.chunks)) {
      throw new Error('localqa_prepare_handoff requires text or chunks');
    }
    return jsonText(await prepareLocalFirstHandoff({
      task: resolveTaskGoal(args),
      text: args.text,
      chunks: args.chunks,
      sourceLabel: args.sourceLabel,
      contextBudgetTokens: args.contextBudgetTokens,
      maxLines: args.maxLines,
      outputDir: args.outputDir,
      destinationKind: args.destinationKind,
      destinationUrl: args.destinationUrl,
      storeRaw: args.storeRaw,
      allowSensitiveCompact: args.allowSensitiveCompact,
    }));
  },
);

server.registerTool(
  'localqa_verify_handoff',
  {
    title: 'Verify local-first handoff proof',
    description: 'Verifies a LocalQA handoff artifact/proof before external send. Use this in host/runtime guardrails to hard-block unverified external payload sends.',
    inputSchema: {
      artifactId: z.string().optional(),
      artifactPath: z.string().optional(),
      compactPayload: z.string().optional(),
      destinationKind: z.enum(['main_llm', 'external_server', 'local_server', 'unknown']).optional(),
      destinationUrl: z.string().optional(),
      outputDir: z.string().optional(),
    },
  },
  async (args) => jsonText(await verifyLocalFirstHandoff(args)),
);

server.registerTool(
  'localqa_cleanup_context',
  {
    title: 'Clean large context locally',
    description: 'Deduplicate, rank, and compact long logs, prompt dumps, browser dumps, or raw evidence before involving a larger LLM.',
    inputSchema: {
      mode: z.enum(['log_analysis', 'prompt_cleanup', 'context_cleanup']).optional(),
      text: z.string().optional(),
      chunks: z.array(z.object({
        label: z.string().optional(),
        text: z.string(),
      })).optional(),
      task: z.string().optional(),
      goal: z.string().optional(),
      sourceLabel: z.string().optional(),
      contextBudgetTokens: z.number().int().positive().optional(),
      maxLines: z.number().int().positive().optional(),
    },
  },
  async (args) => {
    if (!args.text && !Array.isArray(args.chunks)) {
      throw new Error('localqa_cleanup_context requires text or chunks');
    }
    return jsonText(analyzeContextDump({
      mode: args.mode || 'context_cleanup',
      task: resolveTaskGoal(args),
      text: args.text,
      chunks: args.chunks,
      sourceLabel: args.sourceLabel,
      contextBudgetTokens: args.contextBudgetTokens,
      maxLines: args.maxLines,
    }));
  },
);

server.registerTool(
  'localqa_health',
  {
    title: 'LocalQA health check',
    description: 'Check LocalQA runtime health, including Playwright, optional Ollama, and optional OpenAI-compatible local LLM availability.',
    inputSchema: {
      ollamaEndpoint: z.string().url().optional(),
      llmProvider: z.enum(['ollama', 'openai-compatible', 'llama-server', 'openai']).optional(),
      llmEndpoint: z.string().url().optional(),
      llmModel: z.string().optional(),
    },
  },
  async (args) => jsonText(await getHealth(args)),
);

server.registerTool(
  'read_qa_report',
  {
    title: 'Read LocalQA report',
    description: 'Read a previously generated LocalQA JSON report. Use compact=true for token-efficient agent context.',
    inputSchema: {
      reportPath: z.string().min(1),
      compact: z.boolean().optional(),
    },
  },
  async ({ reportPath, compact = true }) => {
    const raw = await fs.readFile(reportPath, 'utf8');
    const report = JSON.parse(raw);
    const value = compact ? summarizeForMcp({ ...report, reportPath }) : report;
    return jsonText(value);
  },
);

server.registerTool(
  'run_ui_qa',
  {
    title: 'Run browser UI QA',
    description: [
      'Run local browser QA against a URL using Playwright.',
      'Collects deterministic evidence, screenshots, optional scripted interactions, and optional Ollama triage.',
    ].join(' '),
    inputSchema: {
      url: z.string().url(),
      goal: z.string().optional(),
      outputDir: z.string().optional(),
      waitMs: z.number().int().nonnegative().optional(),
      expectedText: z.array(z.string()).optional(),
      viewports: z.array(ViewportSchema).optional(),
      screenshot: z.boolean().optional(),
      headless: z.boolean().optional(),
      actions: z.array(ActionSchema).optional(),
      ollamaModel: z.string().optional(),
      ollamaTimeoutMs: z.number().int().positive().optional(),
      ollamaMaxTokens: z.number().int().positive().optional(),
      llmProvider: z.enum(['ollama', 'openai-compatible', 'llama-server', 'openai']).optional(),
      llmModel: z.string().optional(),
      llmEndpoint: z.string().url().optional(),
      llmTimeoutMs: z.number().int().positive().optional(),
      llmMaxTokens: z.number().int().positive().optional(),
      llmTemperature: z.number().nonnegative().optional(),
      llmTopK: z.number().int().nonnegative().optional(),
      llmTopP: z.number().nonnegative().optional(),
    },
  },
  async (args) => {
    const report = await runUiQa({
      url: args.url,
      goal: args.goal,
      outputDir: args.outputDir,
      waitMs: args.waitMs,
      expectedText: args.expectedText,
      viewports: args.viewports,
      actions: args.actions,
      screenshot: args.screenshot,
      headless: args.headless,
      llm: buildLlmOptions(args),
    });
    return jsonText(summarizeForMcp(report));
  },
);

server.registerTool(
  'discover_site_links',
  {
    title: 'Discover same-origin site links',
    description: 'Open a URL in Playwright and return a bounded set of same-origin links for route-level QA planning.',
    inputSchema: {
      url: z.string().url(),
      maxLinks: z.number().int().positive().optional(),
      sameOrigin: z.boolean().optional(),
      waitMs: z.number().int().nonnegative().optional(),
      headless: z.boolean().optional(),
    },
  },
  async (args) => jsonText(await discoverSiteLinks(args)),
);

server.registerTool(
  'run_site_qa',
  {
    title: 'Run multi-route site QA',
    description: 'Discover or accept a bounded route list, run LocalQA on each route, and return an aggregate report.',
    inputSchema: {
      url: z.string().url().optional(),
      urls: z.array(z.string().url()).optional(),
      maxLinks: z.number().int().positive().optional(),
      sameOrigin: z.boolean().optional(),
      outputDir: z.string().optional(),
      goal: z.string().optional(),
      waitMs: z.number().int().nonnegative().optional(),
      expectedText: z.array(z.string()).optional(),
      viewports: z.array(ViewportSchema).optional(),
      screenshot: z.boolean().optional(),
      headless: z.boolean().optional(),
      actions: z.array(ActionSchema).optional(),
      ollamaModel: z.string().optional(),
      ollamaTimeoutMs: z.number().int().positive().optional(),
      ollamaMaxTokens: z.number().int().positive().optional(),
      llmProvider: z.enum(['ollama', 'openai-compatible', 'llama-server', 'openai']).optional(),
      llmModel: z.string().optional(),
      llmEndpoint: z.string().url().optional(),
      llmTimeoutMs: z.number().int().positive().optional(),
      llmMaxTokens: z.number().int().positive().optional(),
      llmTemperature: z.number().nonnegative().optional(),
      llmTopK: z.number().int().nonnegative().optional(),
      llmTopP: z.number().nonnegative().optional(),
    },
  },
  async (args) => {
    if (!args.url && (!Array.isArray(args.urls) || args.urls.length === 0)) {
      throw new Error('run_site_qa requires url or urls');
    }
    const aggregate = await runSiteQa({
      ...args,
      llm: buildLlmOptions(args),
    });
    return jsonText(aggregate);
  },
);

server.registerTool(
  'browser_start_session',
  {
    title: 'Start browser session',
    description: 'Start a persistent local browser session for coding-agent browser work. Safe-by-default; risky non-local actions require explicit allowUnsafe on browser_act.',
    inputSchema: {
      url: z.string().url().optional(),
      viewport: ViewportSchema.optional(),
      outputDir: z.string().optional(),
      waitMs: z.number().int().nonnegative().optional(),
      timeoutMs: z.number().int().positive().optional(),
      screenshot: z.boolean().optional(),
      headless: z.boolean().optional(),
      maxTextChars: z.number().int().positive().optional(),
      maxLinks: z.number().int().positive().optional(),
    },
  },
  async (args) => jsonText(await browserStartSession(args)),
);

server.registerTool(
  'browser_list_sessions',
  {
    title: 'List browser sessions',
    description: 'List active LocalQA browser-agent sessions.',
    inputSchema: {},
  },
  async () => jsonText({ sessions: listBrowserSessions() }),
);

server.registerTool(
  'browser_snapshot',
  {
    title: 'Snapshot browser session',
    description: 'Capture compact DOM, text, links, controls, console/network events, and optional screenshot for an active browser session.',
    inputSchema: {
      sessionId: z.string().min(1),
      outputDir: z.string().optional(),
      screenshot: z.boolean().optional(),
      maxTextChars: z.number().int().positive().optional(),
      maxLinks: z.number().int().positive().optional(),
    },
  },
  async (args) => jsonText(await browserSnapshot(args)),
);

server.registerTool(
  'browser_act',
  {
    title: 'Act in browser session',
    description: 'Perform a bounded browser action in an active session, then return a compact snapshot. Non-local risky clicks are blocked unless allowUnsafe=true.',
    inputSchema: {
      sessionId: z.string().min(1),
      action: BrowserActionSchema,
      allowUnsafe: z.boolean().optional(),
      outputDir: z.string().optional(),
      screenshot: z.boolean().optional(),
      maxTextChars: z.number().int().positive().optional(),
      maxLinks: z.number().int().positive().optional(),
    },
  },
  async (args) => jsonText(await browserAct(args)),
);

server.registerTool(
  'browser_end_session',
  {
    title: 'End browser session',
    description: 'Close an active browser-agent session and return its last snapshot.',
    inputSchema: {
      sessionId: z.string().min(1),
    },
  },
  async (args) => jsonText(await browserEndSession(args)),
);

server.registerTool(
  'browser_extract_page',
  {
    title: 'Extract page',
    description: 'Open a page read-only and return compact text, headings, links, controls, and browser events. Use for docs/research pages before involving the main LLM.',
    inputSchema: {
      url: z.string().url(),
      waitMs: z.number().int().nonnegative().optional(),
      outputDir: z.string().optional(),
      screenshot: z.boolean().optional(),
      viewport: ViewportSchema.optional(),
      maxTextChars: z.number().int().positive().optional(),
      maxLinks: z.number().int().positive().optional(),
    },
  },
  async (args) => jsonText(await browserExtractPage(args)),
);

server.registerTool(
  'browser_open_page',
  {
    title: 'Open page',
    description: 'Alias for browser_extract_page. Opens a page read-only and returns compact extracted evidence.',
    inputSchema: {
      url: z.string().url(),
      waitMs: z.number().int().nonnegative().optional(),
      outputDir: z.string().optional(),
      screenshot: z.boolean().optional(),
      viewport: ViewportSchema.optional(),
      maxTextChars: z.number().int().positive().optional(),
      maxLinks: z.number().int().positive().optional(),
    },
  },
  async (args) => jsonText(await browserExtractPage(args)),
);

server.registerTool(
  'browser_search',
  {
    title: 'Search web for coding research',
    description: 'Run a read-only browser search and return compact result links. Intended for coding/research tasks, not general life automation.',
    inputSchema: {
      query: z.string().min(1),
      maxResults: z.number().int().positive().optional(),
      waitMs: z.number().int().nonnegative().optional(),
    },
  },
  async (args) => jsonText(await browserSearch(args)),
);

server.registerTool(
  'browser_research_task',
  {
    title: 'Run browser research task',
    description: 'Research a coding-related question by searching/extracting pages and returning compact source-backed snippets for the main LLM.',
    inputSchema: {
      query: z.string().min(1),
      urls: z.array(z.string().url()).optional(),
      maxSources: z.number().int().positive().optional(),
      maxSnippets: z.number().int().positive().optional(),
      maxTextChars: z.number().int().positive().optional(),
      waitMs: z.number().int().nonnegative().optional(),
    },
  },
  async (args) => jsonText(await browserResearchTask(args)),
);

server.registerTool(
  'browser_compare_sources',
  {
    title: 'Compare browser sources',
    description: 'Extract and compare a small set of source URLs for a coding/research question. Returns source-backed snippets, not a final expert answer.',
    inputSchema: {
      query: z.string().min(1),
      urls: z.array(z.string().url()).min(2),
      maxSources: z.number().int().positive().optional(),
      maxSnippets: z.number().int().positive().optional(),
      maxTextChars: z.number().int().positive().optional(),
      waitMs: z.number().int().nonnegative().optional(),
    },
  },
  async (args) => jsonText(await browserResearchTask(args)),
);

const transport = new StdioServerTransport();
const startup = await ensureBonsaiServer();
if (startup?.attempted || startup?.alreadyRunning) {
  console.error(`[localqa] Bonsai startup ${startup.ok ? 'ready' : 'not-ready'} ${startup.alreadyRunning ? '(already running)' : ''} endpoint=${startup.endpoint || ''}`);
  if (startup.error) console.error(`[localqa] Bonsai startup error: ${startup.error}`);
}
await server.connect(transport);

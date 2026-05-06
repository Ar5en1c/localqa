#!/usr/bin/env node
import readline from 'node:readline';
import fs from 'node:fs/promises';
import { runUiQa, summarizeForMcp } from './core/qa-core.mjs';

const SERVER_INFO = {
  name: 'localqa',
  version: '0.1.0',
};

const TOOLS = [
  {
    name: 'localqa_health',
    description: 'Check LocalQA runtime health, including Playwright availability and optional Ollama availability.',
    inputSchema: {
      type: 'object',
      properties: {
        ollamaEndpoint: { type: 'string' },
      },
    },
  },
  {
    name: 'read_qa_report',
    description: 'Read a previously generated LocalQA report JSON file.',
    inputSchema: {
      type: 'object',
      required: ['reportPath'],
      properties: {
        reportPath: { type: 'string' },
        compact: { type: 'boolean' },
      },
    },
  },
  {
    name: 'run_ui_qa',
    description: 'Run local browser QA against a URL using Playwright, deterministic checks, screenshots, and optional Ollama triage.',
    inputSchema: {
      type: 'object',
      required: ['url'],
      properties: {
        url: { type: 'string', description: 'Target URL to inspect.' },
        goal: { type: 'string', description: 'What the QA run should verify.' },
        outputDir: { type: 'string', description: 'Optional report output directory.' },
        waitMs: { type: 'number', description: 'Wait after page load/network idle.' },
        expectedText: {
          type: 'array',
          items: { type: 'string' },
          description: 'Texts that should be visible on the page.',
        },
        viewports: {
          type: 'array',
          items: {
            type: 'object',
            required: ['width', 'height'],
            properties: {
              name: { type: 'string' },
              width: { type: 'number' },
              height: { type: 'number' },
            },
          },
        },
        screenshot: { type: 'boolean' },
        headless: { type: 'boolean' },
        actions: {
          type: 'array',
          description: 'Optional scripted actions before final inspection.',
          items: {
            type: 'object',
            required: ['type'],
            properties: {
              type: { type: 'string', description: 'click, fill, press, select, check, uncheck, wait, wait_for_text, assert_text' },
              selector: { type: 'string' },
              value: { type: 'string' },
              text: { type: 'string' },
              key: { type: 'string' },
              timeoutMs: { type: 'number' },
              waitAfterMs: { type: 'number' },
            },
          },
        },
        ollamaModel: { type: 'string', description: 'Developer override for Ollama. Initial release uses Bonsai through the SDK MCP server.' },
      },
    },
  },
];

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function result(id, value) {
  send({ jsonrpc: '2.0', id, result: value });
}

function error(id, code, message, data = undefined) {
  send({
    jsonrpc: '2.0',
    id,
    error: {
      code,
      message,
      ...(data ? { data } : {}),
    },
  });
}

async function handleRequest(request) {
  const { id, method, params } = request;
  if (method === 'initialize') {
    result(id, {
      protocolVersion: params?.protocolVersion || '2024-11-05',
      capabilities: {
        tools: {},
      },
      serverInfo: SERVER_INFO,
    });
    return;
  }
  if (method === 'tools/list') {
    result(id, { tools: TOOLS });
    return;
  }
  if (method === 'tools/call') {
    const name = params?.name;
    const args = params?.arguments || {};
    if (name === 'localqa_health') {
      const health = {
        ok: true,
        playwright: { ok: false },
        ollama: { ok: false },
      };
      try {
        await import('playwright');
        health.playwright = { ok: true };
      } catch (err) {
        health.ok = false;
        health.playwright = { ok: false, error: err?.message || String(err) };
      }
      try {
        const endpoint = args.ollamaEndpoint || 'http://127.0.0.1:11434/api/tags';
        const res = await fetch(endpoint);
        const text = await res.text();
        health.ollama = { ok: res.ok, status: res.status, preview: text.slice(0, 500) };
      } catch (err) {
        health.ollama = { ok: false, error: err?.message || String(err) };
      }
      result(id, {
        content: [{ type: 'text', text: JSON.stringify(health, null, 2) }],
      });
      return;
    }
    if (name === 'read_qa_report') {
      const reportPath = args.reportPath;
      if (!reportPath) {
        error(id, -32602, 'read_qa_report requires reportPath');
        return;
      }
      const raw = await fs.readFile(reportPath, 'utf8');
      const report = JSON.parse(raw);
      const value = args.compact === false ? report : summarizeForMcp({ ...report, reportPath });
      result(id, {
        content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      });
      return;
    }
    if (name !== 'run_ui_qa') {
      error(id, -32602, `Unknown tool: ${name}`);
      return;
    }
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
      llm: args.ollamaModel
        ? {
            enabled: true,
            provider: 'ollama',
            model: args.ollamaModel,
          }
        : null,
    });
    const summary = summarizeForMcp(report);
    result(id, {
      content: [
        {
          type: 'text',
          text: JSON.stringify(summary, null, 2),
        },
      ],
    });
    return;
  }
  if (id == null) return;
  error(id, -32601, `Method not found: ${method}`);
}

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

rl.on('line', async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let request;
  try {
    request = JSON.parse(trimmed);
  } catch (err) {
    error(null, -32700, 'Parse error', String(err?.message || err));
    return;
  }
  try {
    await handleRequest(request);
  } catch (err) {
    error(request?.id ?? null, -32000, err?.message || String(err), err?.stack || undefined);
  }
});

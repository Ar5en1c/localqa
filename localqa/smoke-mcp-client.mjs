#!/usr/bin/env node
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const serverPath = new URL('./mcp-server-sdk.mjs', import.meta.url).pathname;

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
  cwd: process.cwd(),
  env: process.env,
  stderr: 'pipe',
});

const stderrChunks = [];
transport.stderr?.on('data', (chunk) => {
  stderrChunks.push(String(chunk));
});

const client = new Client({
  name: 'localqa-smoke-client',
  version: '0.1.0',
});

try {
  await client.connect(transport);
  const tools = await client.listTools();
  const toolNames = tools.tools.map((tool) => tool.name);
  const llmEndpoint = process.env.LOCALQA_LLM_ENDPOINT || '';
  const llmModel = process.env.LOCALQA_LLM_MODEL || '';
  let parsedHealth = null;
  if (toolNames.includes('localqa_health')) {
    const health = await client.callTool({
      name: 'localqa_health',
      arguments: llmEndpoint
        ? {
            llmProvider: process.env.LOCALQA_LLM_PROVIDER || 'openai-compatible',
            llmEndpoint,
            ...(llmModel ? { llmModel } : {}),
          }
        : {},
    });

    const healthText = health?.content?.find((item) => item.type === 'text')?.text || '{}';
    parsedHealth = JSON.parse(healthText);
  }

  console.log(JSON.stringify({
    ok: true,
    server: 'localqa',
    toolNames,
    health: parsedHealth,
    stderr: stderrChunks.join('').trim(),
  }, null, 2));
} finally {
  await client.close();
}

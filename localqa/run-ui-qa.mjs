#!/usr/bin/env node
import { runUiQa, DEFAULT_VIEWPORTS } from './core/qa-core.mjs';

function parseArgs(argv) {
  const options = {
    url: '',
    goal: '',
    outputDir: '',
    waitMs: 500,
    screenshot: true,
    headless: true,
    expectedText: [],
    actions: [],
    viewports: DEFAULT_VIEWPORTS,
    llm: null,
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if ((arg === '--url' || arg === '-u') && next) {
      options.url = next;
      i += 1;
      continue;
    }
    if ((arg === '--goal' || arg === '-g') && next) {
      options.goal = next;
      i += 1;
      continue;
    }
    if ((arg === '--out' || arg === '-o') && next) {
      options.outputDir = next;
      i += 1;
      continue;
    }
    if (arg === '--wait-ms' && next) {
      options.waitMs = Number.parseInt(next, 10) || options.waitMs;
      i += 1;
      continue;
    }
    if (arg === '--expected-text' && next) {
      options.expectedText.push(next);
      i += 1;
      continue;
    }
    if (arg === '--action-json' && next) {
      try {
        const parsed = JSON.parse(next);
        if (Array.isArray(parsed)) options.actions.push(...parsed);
        else if (parsed && typeof parsed === 'object') options.actions.push(parsed);
      } catch (err) {
        throw new Error(`Invalid --action-json: ${err?.message || err}`);
      }
      i += 1;
      continue;
    }
    if (arg === '--click' && next) {
      options.actions.push({ type: 'click', selector: next });
      i += 1;
      continue;
    }
    if (arg === '--fill' && next) {
      const splitAt = next.indexOf('=');
      if (splitAt < 1) throw new Error('--fill expects selector=value');
      options.actions.push({ type: 'fill', selector: next.slice(0, splitAt), value: next.slice(splitAt + 1) });
      i += 1;
      continue;
    }
    if (arg === '--press' && next) {
      const splitAt = next.lastIndexOf(':');
      if (splitAt < 1) throw new Error('--press expects selector:key');
      options.actions.push({ type: 'press', selector: next.slice(0, splitAt), key: next.slice(splitAt + 1) });
      i += 1;
      continue;
    }
    if (arg === '--wait-for-text' && next) {
      options.actions.push({ type: 'wait_for_text', text: next });
      i += 1;
      continue;
    }
    if (arg === '--viewport' && next) {
      const [name, size] = next.includes(':') ? next.split(':') : [`custom_${i}`, next];
      const [width, height] = String(size || '').split('x').map((value) => Number.parseInt(value, 10));
      if (width > 0 && height > 0) {
        if (options._customViewports == null) options._customViewports = [];
        options._customViewports.push({ name, width, height });
      }
      i += 1;
      continue;
    }
    if (arg === '--ollama-model' && next) {
      options.llm = {
        enabled: true,
        provider: 'ollama',
        model: next,
      };
      i += 1;
      continue;
    }
    if (arg === '--llm-provider' && next) {
      options.llm = {
        ...(options.llm || { enabled: true }),
        provider: next,
      };
      i += 1;
      continue;
    }
    if (arg === '--llm-model' && next) {
      options.llm = {
        ...(options.llm || { enabled: true }),
        model: next,
      };
      i += 1;
      continue;
    }
    if (arg === '--llm-endpoint' && next) {
      options.llm = {
        ...(options.llm || { enabled: true }),
        provider: options.llm?.provider || 'openai-compatible',
        endpoint: next,
      };
      i += 1;
      continue;
    }
    if (arg === '--llm-timeout-ms' && next) {
      options.llm = {
        ...(options.llm || { enabled: true }),
        timeoutMs: Number.parseInt(next, 10) || 30000,
      };
      i += 1;
      continue;
    }
    if (arg === '--llm-max-tokens' && next) {
      options.llm = {
        ...(options.llm || { enabled: true }),
        maxTokens: Number.parseInt(next, 10) || 384,
      };
      i += 1;
      continue;
    }
    if (arg === '--llm-temperature' && next) {
      options.llm = {
        ...(options.llm || { enabled: true }),
        temperature: Number.parseFloat(next),
      };
      i += 1;
      continue;
    }
    if (arg === '--llm-top-k' && next) {
      options.llm = {
        ...(options.llm || { enabled: true }),
        topK: Number.parseInt(next, 10),
      };
      i += 1;
      continue;
    }
    if (arg === '--llm-top-p' && next) {
      options.llm = {
        ...(options.llm || { enabled: true }),
        topP: Number.parseFloat(next),
      };
      i += 1;
      continue;
    }
    if (arg === '--ollama-timeout-ms' && next) {
      options.llm = {
        ...(options.llm || { enabled: true, provider: 'ollama' }),
        timeoutMs: Number.parseInt(next, 10) || 30000,
      };
      i += 1;
      continue;
    }
    if (arg === '--ollama-max-tokens' && next) {
      options.llm = {
        ...(options.llm || { enabled: true, provider: 'ollama' }),
        maxTokens: Number.parseInt(next, 10) || 384,
      };
      i += 1;
      continue;
    }
    if (arg === '--ollama-endpoint' && next) {
      options.llm = {
        ...(options.llm || { enabled: true, provider: 'ollama' }),
        endpoint: next,
      };
      i += 1;
      continue;
    }
    if (arg === '--no-screenshot') {
      options.screenshot = false;
      continue;
    }
    if (arg === '--headed') {
      options.headless = false;
      continue;
    }
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
  }

  if (options._customViewports) {
    options.viewports = options._customViewports;
    delete options._customViewports;
  }

  return options;
}

function printHelp() {
  console.log(`LocalQA browser runner

Usage:
  npm run localqa:run -- --url http://localhost:3000 --goal "Test signup page"

Options:
  --url, -u              Target URL
  --goal, -g             Test goal
  --out, -o              Output directory
  --viewport name:WxH    Add viewport, for example mobile:390x844
  --expected-text TEXT   Require visible text
  --click SELECTOR       Click an element before inspection
  --fill SELECTOR=VALUE  Fill an input before inspection
  --press SELECTOR:KEY   Press a key on an element
  --wait-for-text TEXT   Wait for text before inspection
  --action-json JSON     Add one action or an array of actions
  --wait-ms N            Wait after network idle
  --ollama-model MODEL   Developer override for Ollama triage. Initial release uses Bonsai through --llm-provider openai-compatible.
  --ollama-timeout-ms N  Ollama request timeout
  --ollama-max-tokens N  Ollama max output tokens
  --llm-provider NAME    Optional local LLM provider: openai-compatible for Bonsai release runtime
  --llm-model MODEL      Optional local LLM model name, release default: Bonsai-8B.gguf
  --llm-endpoint URL     Optional local LLM endpoint, release default: http://127.0.0.1:18081/v1/chat/completions
  --llm-temperature N    Optional sampling temperature
  --llm-top-k N          Optional top-k sampling
  --llm-top-p N          Optional top-p sampling
  --llm-timeout-ms N     Optional local LLM request timeout
  --llm-max-tokens N     Optional local LLM max output tokens
  --no-screenshot        Disable screenshots
  --headed               Run visible browser
  --json                 Print full JSON report

Bonsai native example:
  npm run localqa:bonsai:serve
  npm run localqa:run -- \\
    --url http://localhost:3000 \\
    --goal "Test the page" \\
    --llm-provider openai-compatible \\
    --llm-model bonsai \\
    --llm-endpoint http://127.0.0.1:18081/v1/chat/completions \\
    --llm-temperature 0.5 \\
    --llm-top-k 20 \\
    --llm-top-p 0.85
`);
}

function compactCliSummary(report) {
  return {
    runId: report.runId,
    url: report.target.url,
    reportPath: report.reportPath,
    totalMs: report.timings.totalMs,
    findings: report.findings.length,
    topFindings: report.findings.slice(0, 8),
    llmSummary: report.llmSummary,
    tokenSavings: report.tokenSavings,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help || !options.url) {
    printHelp();
    process.exit(options.help ? 0 : 1);
  }
  const report = await runUiQa(options);
  const output = options.json ? report : compactCliSummary(report);
  console.log(JSON.stringify(output, null, 2));
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});

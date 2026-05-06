# LocalQA Browser MCP

LocalQA is a local-first browser QA and research agent for coding assistants.

It runs beside the coding agent as an MCP server. The browser work happens locally through Playwright. For the initial release, local model triage is standardized on `Bonsai-8B.gguf` served through the native Prism/llama.cpp `llama-server` OpenAI-compatible endpoint.

The goal is to keep the main LLM focused on coding decisions while LocalQA handles repetitive browser work: UI testing, bug reproduction, page extraction, docs research, source comparison, screenshots, DOM summaries, console/network evidence, and compact report handoff.

The public product direction is documented in [`../docs/LOCAL_AGENT_MCP_PROJECT_SPEC.md`](../docs/LOCAL_AGENT_MCP_PROJECT_SPEC.md).

Client setup examples are in [`../docs/LOCAL_AGENT_MCP_CLIENT_SETUP.md`](../docs/LOCAL_AGENT_MCP_CLIENT_SETUP.md).

Release checklist is in [`../docs/LOCAL_AGENT_MCP_RELEASE_CHECKLIST.md`](../docs/LOCAL_AGENT_MCP_RELEASE_CHECKLIST.md).

## Public one-call facade

Use `local_agent_run` first. It is the local sub-agent manager tool for coding agents.

Example:

```json
{
  "tool": "local_agent_run",
  "arguments": {
    "url": "http://localhost:3000/login",
    "task": "Test login and sign-up UX. Report only verified issues.",
    "contextBudgetTokens": 6000,
    "llmProvider": "openai-compatible",
    "llmModel": "Bonsai-8B.gguf",
    "llmEndpoint": "http://127.0.0.1:18081/v1/chat/completions",
    "llmTemperature": 0.5,
    "llmTopK": 20,
    "llmTopP": 0.85
  }
}
```

Supported high-level modes:

| Mode | Purpose |
|---|---|
| `browser_qa` | Test one page with Playwright, deterministic evidence, screenshots, and optional local LLM triage |
| `site_qa` | Discover or accept multiple routes and aggregate QA results |
| `research` | Extract and summarize coding-related web sources |
| `extract_page` | Convert one page into compact structured context |
| `log_analysis` | Deduplicate and rank long logs before the main LLM sees them |
| `prompt_cleanup` | Compress large prompt dumps into a budgeted high-signal packet |
| `context_cleanup` | Generic local context cleaning for raw evidence dumps |
| `handoff_gate` | Prepare local-first compact payload before sending evidence to a main LLM or external server |

The lower-level MCP tools remain available for advanced workflows and debugging.

Release default is `LOCALQA_PUBLIC_SURFACE=agent-strict`, so the main agent sees only `local_agent_run` unless you explicitly override to `agent` or `full`.

Use [`../docs/LOCAL_AGENT_MCP_ROUTING_POLICY.md`](../docs/LOCAL_AGENT_MCP_ROUTING_POLICY.md) as the agent instruction that forces raw browser/log/context data through LocalQA before server handoff.

## Architecture

```text
Codex / Claude / Cursor
  -> LocalQA MCP server over stdio
  -> local_agent_run
  -> Playwright browser worker
  -> deterministic checks / browser sessions / extraction
  -> optional local LLM triage or extractive research
  -> compact evidence report for the main LLM
```

The deterministic layer checks:

- page errors
- console errors
- failed network requests
- HTTP 4xx/5xx responses
- horizontal overflow
- clipped interactive elements
- unlabeled controls
- broken images
- missing expected text

The optional local LLM only summarizes and triages evidence. It does not blindly drive the browser.

## MCP tool groups

### Primary delegation tool

- `local_agent_run`
- `localqa_prepare_handoff`

Use `local_agent_run` for normal coding-agent workflows. It routes internally to browser QA, site QA, research, extraction, prompt cleanup, log analysis, handoff gating, and local Bonsai triage.

The `local_agent_run` response explicitly identifies the MCP-local agent boundary:

- `agentType: "local_mcp_agent"`
- `executionMode: "local_first"`
- `publicTool: "local_agent_run"`
- `steps: [...]` (internal tool execution trace)
- `telemetry.internalStepCount`
- `telemetry.externalCalls`
- `enforcement` with runtime guard decisions (`blocked`, `allowedPayload`, `handoffProof`)

### QA tools

- `localqa_health`
- `run_ui_qa`
- `run_site_qa`
- `discover_site_links`
- `read_qa_report`

### Browser session tools

- `browser_start_session`
- `browser_snapshot`
- `browser_act`
- `browser_end_session`
- `browser_list_sessions`

Use these when the coding agent needs a short browser loop: open page, inspect state, click/fill/wait, inspect again.

### Research tools

- `browser_open_page`
- `browser_extract_page`
- `browser_search`
- `browser_research_task`
- `browser_compare_sources`

Use these for coding-related docs/research tasks where the main LLM should receive compact, source-backed snippets instead of raw page dumps.

### Handoff verification guard (host/runtime)

For host-side hard enforcement before any external model/server send:

- call `local_agent_run` with `destinationKind`
- if `enforcement.handoffProof` is present, verify using `localqa_verify_handoff` (available in `agent`/`full` surfaces)
- block send when:
  - `enforcement.blocked=true`
  - or `localqa_verify_handoff.verified=false`

## Safety policy

Default mode is safe-by-default:

- Allowed: read pages, search docs, inspect GitHub/docs, test localhost apps, fill local/test forms, click safe local UI, capture screenshots, extract text.
- Blocked unless explicitly approved: purchases, payments, bookings, job applications, destructive admin actions, account mutations, real-world form submissions, messages/emails.
- `browser_act` blocks risky non-local clicks unless `allowUnsafe=true`.

## CLI usage

Install Playwright if needed:

```bash
npm install -D playwright
npx playwright install chromium
```

Run deterministic QA:

```bash
npm run localqa:run -- \
  --url http://localhost:3000 \
  --goal "Test the signup page for visible UI, console, and form issues"
```

Developer override: run with an optional Ollama summary:

```bash
npm run localqa:run -- \
  --url http://localhost:3000 \
  --goal "Test the signup page" \
  --ollama-model qwen2.5-coder:3b
```

The Ollama path is a developer override only. Initial-release docs, validation, and benchmarks use Bonsai as the single reference model.

Run with Bonsai through the native Prism/llama-server path manually:

```bash
npm run localqa:bonsai:serve
```

In another terminal:

```bash
npm run localqa:run -- \
  --url http://localhost:3000 \
  --goal "Test the signup page for browser, accessibility, layout, console, and network issues" \
  --llm-provider openai-compatible \
  --llm-model bonsai \
  --llm-endpoint http://127.0.0.1:18081/v1/chat/completions \
  --llm-temperature 0.5 \
  --llm-top-k 20 \
  --llm-top-p 0.85 \
  --llm-timeout-ms 60000 \
  --llm-max-tokens 128
```

Smoke-test the MCP server and the Bonsai endpoint together:

```bash
LOCALQA_DEFAULT_LLM=bonsai \
LOCALQA_BONSAI_AUTOSTART=1 \
LOCALQA_LLM_ENDPOINT=http://127.0.0.1:18081/v1/chat/completions \
LOCALQA_LLM_MODEL=Bonsai-8B.gguf \
npm run localqa:mcp:smoke
```

For normal MCP client usage, set `LOCALQA_BONSAI_AUTOSTART=1` and the MCP will start the Bonsai server during chat/tool load if it is not already running.

Run scripted interactions before inspection:

```bash
npm run localqa:run -- \
  --url http://localhost:3000/signup \
  --goal "Check signup form behavior" \
  --fill "input[type=email]=test@example.com" \
  --click "button[type=submit]" \
  --wait-for-text "Check your email"
```

Add custom viewports:

```bash
npm run localqa:run -- \
  --url http://localhost:3000 \
  --viewport desktop:1440x900 \
  --viewport mobile:390x844
```

## MCP server

Start the server:

```bash
npm run localqa:mcp
```

Expose this command to a coding agent as an MCP server. The default command uses the official `@modelcontextprotocol/sdk` stdio server.

Smoke-test the MCP server locally:

```bash
npm run localqa:mcp:smoke
```

The server provides:

- `local_agent_run`
- `localqa_health`
- `run_ui_qa`
- `read_qa_report`
- `discover_site_links`
- `run_site_qa`
- `browser_start_session`
- `browser_snapshot`
- `browser_act`
- `browser_end_session`
- `browser_extract_page`
- `browser_search`
- `browser_research_task`
- `browser_compare_sources`

`run_ui_qa` returns a compact JSON report with findings, evidence, screenshots, and an approximate token-savings estimate.

`run_site_qa` discovers a bounded same-origin route list or accepts explicit URLs, runs route-level QA, and writes an aggregate `site-report.json`.

The previous newline JSON-RPC server remains available as:

```bash
npm run localqa:mcp:legacy
```

## Browser-agent examples

Start a session, inspect, act, then close through MCP:

```json
{
  "tool": "browser_start_session",
  "arguments": {
    "url": "http://localhost:3000",
    "screenshot": true
  }
}
```

```json
{
  "tool": "browser_act",
  "arguments": {
    "sessionId": "browser-...",
    "action": {
      "type": "click",
      "selector": "button[type=submit]"
    }
  }
}
```

Extract a docs page for the main LLM:

```json
{
  "tool": "browser_extract_page",
  "arguments": {
    "url": "https://playwright.dev/docs/test-snapshots",
    "maxTextChars": 8000
  }
}
```

Run source-backed research:

```json
{
  "tool": "browser_research_task",
  "arguments": {
    "query": "Playwright screenshot comparison API",
    "urls": ["https://playwright.dev/docs/test-snapshots"]
  }
}
```

## LocalQA Studio

Start the local web app:

```bash
npm run localqa:studio
```

Open:

```text
http://127.0.0.1:6197
```

Studio is the human-facing product surface. It can run a single-page review, run a bounded same-origin site review, show recent reports, and choose a local model escalation mode:

- `Fast deterministic`: Playwright evidence only.
- `Code thinking`: deterministic evidence plus Ollama chat with thinking enabled. The default balanced local model is `qwen2.5-coder:3b`.
- `Vision screenshot`: deterministic evidence plus screenshots sent to a multimodal Ollama model.
- `Vision + thinking`: screenshot review with thinking enabled for hard visual/debug issues.

Use model-assisted modes only when the deterministic report needs judgment. For the initial release, use `Bonsai-8B.gguf` through Prism `llama-server`.

Current local model recommendation:

| Mode | Model | Use |
|---|---|---|
| `release` | `Bonsai-8B.gguf` | Initial-release local evidence triage |
| `quality` | `qwen3.5:4b` | Slower, cleaner founder-facing review |
| `developer_override` | custom local model | Private experiments only |

Prompt rule: separate confirmed failures from unproven signals. A single HTTP 4xx response is not a launch blocker unless the user journey actually failed.

Current Bonsai recommendation:

| Mode | Runtime | Model | Use |
|---|---|---|---|
| `bonsai-fast-evidence` | Prism llama-server | `Bonsai-8B.gguf` | Fast local evidence triage with strict JSON |

Bonsai is not an Ollama model on this machine because this GGUF uses Prism's custom quantization. Use `npm run localqa:bonsai:serve`, then connect through `--llm-provider openai-compatible`.

## Current MVP boundary

This is not trying to replace frontier models.

The goal is to avoid wasting frontier-model tokens on repetitive browser inspection and source extraction. Playwright and deterministic checks collect hard evidence locally. A local model or extractive research pass can summarize evidence when useful.

## Next improvements

- Add screenshot-diff comparison.
- Add richer form-flow test plans.
- Add native Ollama model warmup and health checks.
- Add MCP resource links for screenshots and report files.
- Add a small demo broken app for YC/application video.
- Add stronger source-ranking for research mode.
- Add explicit approval UX for unsafe non-local browser actions.

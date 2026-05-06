# LocalQA Install and Usage

LocalQA v0.1 alpha has two launch surfaces:

- MCP-first public interface: recommended starting point.
- OpenCode plugin: advanced integration for OpenCode users.

## Requirements

- Node.js 20+
- npm
- Playwright Chromium for browser QA
- Optional Bonsai local worker runtime for model-assisted triage

Install dependencies:

```bash
npm install
npx playwright install chromium
```

## MCP usage

Start strict public MCP mode:

```bash
LOCALQA_PUBLIC_SURFACE=agent-strict npm run localqa:mcp
```

In strict mode, the agent sees one public tool:

```text
local_agent_run
```

This is intentional. The main agent should delegate local evidence work through one tool instead of seeing every internal browser/log/research primitive.

## MCP client command

Use this command in an MCP-compatible coding agent:

```json
{
  "command": "npm",
  "args": ["run", "localqa:mcp"],
  "env": {
    "LOCALQA_PUBLIC_SURFACE": "agent-strict",
    "LOCALQA_DEFAULT_LLM": "bonsai",
    "LOCALQA_BONSAI_AUTOSTART": "1",
    "LOCALQA_LLM_PROVIDER": "openai-compatible",
    "LOCALQA_LLM_ENDPOINT": "http://127.0.0.1:18081/v1/chat/completions",
    "LOCALQA_LLM_MODEL": "Bonsai-8B.gguf"
  }
}
```

## Best agent instruction

```text
Use LocalQA as the local evidence and memory layer. You remain responsible for planning and implementation. Before reading large logs, browser evidence, DOM dumps, screenshots, network traces, or repeated repo context, call local_agent_run. Prefer directed mode for complex work: specify exact directedSteps, budgets, and outputContract. Query LocalQA memory before repeating project work. Record meaningful results after work is completed.
```

## Directed mode example

```json
{
  "controlMode": "directed",
  "task": "Investigate login QA failures and return verified evidence only.",
  "directedSteps": [
    {
      "tool": "browser_qa",
      "url": "http://localhost:3000/login",
      "task": "Collect screenshot, console, network, accessibility, and form-state evidence."
    },
    {
      "tool": "log_analysis",
      "filePath": "./logs/dev.log",
      "task": "Find auth, session, csrf, 401, 500, and stack-trace evidence."
    }
  ],
  "outputContract": {
    "maxTokens": 1600,
    "include": ["verified_findings", "evidence", "likely_files", "risks", "next_actions"],
    "exclude": ["raw_dom", "full_logs", "screenshot_metadata"]
  }
}
```

## OpenCode plugin usage

The repo includes OpenCode integration files:

```text
opencode.json
.opencode/plugins/localqa.ts
.opencode/tools/local_agent_run.ts
.opencode/tools/answer_from_handle.ts
.opencode/LOCALQA_RULES.md
```

Use OpenCode from the repo root. The plugin/rules are loaded from `opencode.json`.

OpenCode integration is for stronger local-agent workflows:

- `local_agent_run` as a native tool
- `answer_from_handle` for querying local evidence vault handles
- LocalQA rules that instruct the model to use LocalQA before raw evidence handling
- large tool-output compaction hooks
- project-local memory and evidence handles

## Bonsai role

Bonsai is the local worker model for the initial release. It handles local evidence triage, cleanup, project memory, and handoff preparation.

The frontier model still plans and implements. Do not position Bonsai as replacing GPT, Claude, Codex, or other frontier coding models.

## Validation

Run before trusting a local checkout:

```bash
npm run localqa:launch-check
```

Optional provider telemetry A/B benchmark:

```bash
npm run localqa:bench:provider-telemetry
```

The provider telemetry command runs real OpenCode provider sessions and may depend on your OpenCode/provider setup.

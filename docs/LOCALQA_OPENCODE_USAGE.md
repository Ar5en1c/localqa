# LocalQA OpenCode Usage

LocalQA launches MCP-first, but this repo also includes an OpenCode plugin integration.

## Why OpenCode plugin exists

MCP is portable, but advisory. The main model has to choose to call the MCP tool.

OpenCode plugin mode is stronger because the host can load LocalQA as native tools/rules/hooks:

- `local_agent_run` native tool
- `answer_from_handle` native vault query tool
- LocalQA rules loaded from `.opencode/LOCALQA_RULES.md`
- tool-result compaction hooks
- shell env injection for local Bonsai settings
- compaction-time vault/memory reminders

This still is not a first-prompt network firewall. If the user pastes raw evidence directly into a cloud chat prompt, that data has already gone to the cloud.

## Files

```text
opencode.json
.opencode/plugins/localqa.ts
.opencode/tools/local_agent_run.ts
.opencode/tools/answer_from_handle.ts
.opencode/LOCALQA_RULES.md
```

## How to use

Run OpenCode from this repo root so `opencode.json` is discovered.

The agent should see/use:

```text
local_agent_run
answer_from_handle
```

Use this task style:

```text
Use LocalQA to inspect the local logs and browser evidence for the login failure. Do not read raw logs directly. Ask LocalQA for compact verified evidence, then propose the smallest patch plan.
```

## Directed OpenCode task example

Ask the frontier model to call `local_agent_run` with:

```json
{
  "controlMode": "directed",
  "task": "Prepare implementation context for a Fastify validation error-response fix.",
  "directedSteps": [
    {
      "tool": "memory_query",
      "question": "What did we already try for Fastify validation and error responses?"
    },
    {
      "tool": "context_cleanup",
      "filePath": "./reports/localqa/fixtures/fastify-evidence.txt",
      "contextBudgetTokens": 1400
    }
  ],
  "outputContract": {
    "maxTokens": 1600,
    "include": ["verified_findings", "likely_files", "implementation_plan", "risks"],
    "exclude": ["raw_logs", "full_file_dump"]
  }
}
```

## What to demo publicly

For a clean OpenCode demo, show:

1. OpenCode receives a short task.
2. It calls `local_agent_run` instead of reading raw logs directly.
3. LocalQA returns compact evidence and token savings.
4. The frontier model uses the compact evidence to plan or patch.
5. If needed, it calls `answer_from_handle` for scoped follow-up evidence.

The existing launch video proves the launch checks and benchmark numbers. It does not yet show this full OpenCode interaction, so phrase OpenCode as an integration path, not the primary demo surface.

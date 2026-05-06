# LocalQA Public Alpha

LocalQA is a local evidence and memory layer for frontier coding agents.

It does not replace GPT, Claude, Codex, or other frontier models. It helps them work better by running noisy evidence work locally: browser QA, log cleanup, repo evidence compression, project memory, handoff redaction, and targeted context packaging.

For the initial alpha, LocalQA is designed around Bonsai as the local worker model for evidence triage, cleanup, project memory, and handoff preparation. The frontier model still plans and writes code. Bonsai handles noisy local evidence before the frontier model sees a compact verified report.

## Why this exists

Normal coding agents waste context on low-value evidence work:

- raw logs
- browser console dumps
- network traces
- DOM/a11y snapshots
- repeated repo scans
- repeated documentation extracts
- forgotten prior attempts
- noisy terminal output

LocalQA turns that into compact local evidence before the frontier model reasons or implements.

## What is launch-ready

| Capability | Status |
|---|---|
| One-tool MCP surface | Ready: strict mode exposes only `local_agent_run` |
| Bonsai local worker model | Initial release reference model for local evidence triage and cleanup |
| OpenCode plugin | Ready: compacts large tool outputs and injects LocalQA env/rules |
| Directed execution | Ready: main model can provide exact `directedSteps` |
| Strict execution | Ready: rejects unknown local tools |
| Local project memory | Ready: record/query through `controlMode=record` and `controlMode=memory` |
| Log/context cleanup | Ready |
| Browser QA | Available, but browser permissions can be environment-specific |
| Handoff redaction | Ready for runner-facing synthetic secret tests |
| Patch correctness | Not claimed |
| First-prompt interception | Not claimed |

## Defensible benchmark numbers

Latest launch check:

```bash
npm run localqa:launch-check
```

Current reproduced numbers from this repo:

- Complex OSS code tasks: `100,952` raw tokens -> `2,606` compact tokens at 800-token scout profile.
- Complex OSS reduction: `97.42%`.
- Complex OSS frontier-ready orientation gates: `3/3` tasks.
- Multi-step agentic workflows: `100,924` raw tokens -> `5,685` compact tokens.
- Multi-step agentic reduction: `94.37%`.
- Multi-step agentic quality gates: `3/3` passing, average quality score `0.927`.
- A/B proxy vs targeted normal-agent evidence: `25,829` baseline tokens -> `6,704` LocalQA tokens.
- A/B proxy reduction: `74.04%`, with quality gates passing on `3/3` LocalQA tasks.
- OpenCode provider telemetry A/B: raw-attachment baseline used `25,850` input tokens; LocalQA-directed run used `12,048` input tokens.
- OpenCode provider telemetry input reduction: `53.39%` on one controlled Fastify evidence task. Total-token reduction was `14.88%` because OpenCode reported `9,728` cache-read tokens on the LocalQA run.
- Long-horizon 300k simulation: `302,772` raw tokens -> `8,842` compact tokens.
- Long-horizon reduction: `97.08%`, with quality gates passing on `9/9` phases and memory written on `9/9` phases.
- Directed Fastify evidence path: `41,857` raw tokens -> `843` compact tokens.
- Directed Fastify reduction: `97.99%`.
- Directed local runtime: about `110ms` in the last real-env run.
- Full test suite: `81/81` passing in the last launch check.

Reports:

- `reports/localqa/launch_check_2026-05-05/LOCALQA_LAUNCH_CHECK.md`
- `reports/localqa/provider_telemetry_2026-05-05/OPENCODE_PROVIDER_TELEMETRY_AB.md`
- `reports/localqa/long_horizon_300k_2026-05-05/LONG_HORIZON_300K_BENCHMARK.md`
- `reports/localqa/ab_agent_workflows_2026-05-05/AB_AGENT_WORKFLOW_BENCHMARK.md`
- `reports/localqa/agentic_workflows_2026-05-05/AGENTIC_WORKFLOW_BENCHMARK.md`
- `reports/localqa/agent_layer_real_env_2026-05-05/AGENT_LAYER_REAL_ENV_BENCHMARK.md`
- `reports/localqa/complex_code_tasks_2026-05-05/COMPLEX_CODE_TASK_BENCHMARK.md`

## Quickstart: MCP

Run the MCP server:

```bash
LOCALQA_PUBLIC_SURFACE=agent-strict npm run localqa:mcp
```

In strict public mode, the main agent sees one tool:

```text
local_agent_run
```

Use short prompts that point LocalQA at local files or URLs instead of pasting raw evidence into cloud chat.

Good:

```text
Use LocalQA to analyze ./logs/dev.log and return only verified auth/session errors.
```

Bad:

```text
Here are 50,000 characters of logs pasted directly into the cloud chat...
```

If the user pastes raw evidence into cloud chat, it has already gone to the cloud. LocalQA prevents future raw evidence collection and repeated dumps when given paths, URLs, or tasks.

## Quickstart: OpenCode plugin

The repo includes:

- `opencode.json`
- `.opencode/plugins/localqa.ts`
- `.opencode/tools/local_agent_run.ts`
- `.opencode/tools/answer_from_handle.ts`
- `.opencode/LOCALQA_RULES.md`

The plugin gives OpenCode a local evidence layer and rules for using it before large reads, browser QA, raw logs, or memory-sensitive tasks.

## Best agent prompt

Use this with a frontier coding agent:

```text
Use LocalQA as the local evidence and memory layer. You remain responsible for planning and implementation. Before reading large logs, browser evidence, DOM dumps, screenshots, network traces, or repeated repo context, call local_agent_run. Prefer directed mode for complex work: specify exact directedSteps, budgets, and outputContract. Query LocalQA memory before repeating project work. Record meaningful results after work is completed.
```

## Directed execution example

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

## Memory examples

Query local project memory:

```json
{
  "controlMode": "memory",
  "question": "What did we already try for browser QA and what failed?",
  "maxEntries": 8
}
```

Record work:

```json
{
  "controlMode": "record",
  "task": "Record today's LocalQA work.",
  "whatChanged": "Added directed execution and project memory.",
  "testsRun": "npm run localqa:launch-check",
  "workResult": "Launch check passed with reproduced benchmark numbers.",
  "next": ["Record a short demo video", "Publish alpha docs"],
  "tags": ["localqa", "launch", "alpha"]
}
```

## Safe public claim

LocalQA helps frontier coding agents use less context by collecting, compressing, remembering, and verifying local evidence before the model reasons or implements. In the initial alpha, Bonsai is the local worker model used for the local evidence path.

The compression ratios compare reproducible local evidence bundles against LocalQA compact output. The A/B proxy compares against a targeted normal-agent evidence path rather than a full dump. Real per-session billed savings depend on how many files, logs, browser traces, or commands the frontier agent would have read without LocalQA.

Provider telemetry can be tested with:

```bash
npm run localqa:bench:provider-telemetry
```

This command runs real OpenCode provider sessions, so it is intentionally not part of the default launch check.

## Claims to avoid

Do not claim:

- LocalQA replaces frontier models.
- LocalQA intercepts the first cloud prompt.
- LocalQA prevents data leakage if the user pastes raw data directly into cloud chat.
- LocalQA proves patch correctness.
- Browser QA is permission-free on every machine.

## Launch posture

Ship as `v0.1 alpha` / technical preview for developers who already use coding agents and understand token/context waste.

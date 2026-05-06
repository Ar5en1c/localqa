# LocalQA Public Alpha

## Agent for your agents

LocalQA is a Bonsai-backed local sidecar for frontier coding agents.

The frontier model still plans and writes code. LocalQA handles noisy local evidence: logs, browser QA, repo context, docs, project memory, handoff redaction, and context cleanup.

## Launch surfaces

| Surface | Role | Use when |
|---|---|---|
| MCP server | Primary public interface | You want a portable one-tool local assistant for any MCP-compatible agent |
| OpenCode plugin | Advanced integration | You use OpenCode and want native tools, rules, hooks, vault handles, and automatic compaction |

Positioning:

```text
LocalQA is MCP-first, with an OpenCode plugin integration.
```

## The model split

| Layer | Responsibility |
|---|---|
| Frontier model | Plan, reason, implement, decide final changes |
| Bonsai | Local evidence triage, cleanup, memory, handoff prep |
| LocalQA | Tooling layer that connects local files/browser/repo evidence to the agent workflow |

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

| Benchmark | Raw/baseline | LocalQA | Reduction | Quality |
|---|---:|---:|---:|---|
| OpenCode provider telemetry A/B | `25,850` input tokens | `12,048` input tokens | `53.39%` | One controlled Fastify task |
| A/B proxy vs targeted normal-agent evidence | `25,829` tokens | `6,704` tokens | `74.04%` | `3/3` quality gates |
| Multi-step agentic workflows | `100,924` tokens | `5,685` tokens | `94.37%` | `3/3` passing |
| Long-horizon 300k simulation | `302,772` tokens | `8,842` tokens | `97.08%` | `9/9` quality gates, `9/9` memory writes |
| Complex OSS code tasks | `100,952` tokens | `2,606` tokens | `97.42%` | `3/3` frontier-ready |

Reports:

- `reports/localqa/launch_check_2026-05-06/LOCALQA_LAUNCH_CHECK.md`
- `reports/localqa/provider_telemetry_2026-05-05/OPENCODE_PROVIDER_TELEMETRY_AB.md`
- `reports/localqa/long_horizon_300k_2026-05-05/LONG_HORIZON_300K_BENCHMARK.md`
- `reports/localqa/ab_agent_workflows_2026-05-05/AB_AGENT_WORKFLOW_BENCHMARK.md`
- `reports/localqa/agentic_workflows_2026-05-05/AGENTIC_WORKFLOW_BENCHMARK.md`
- `reports/localqa/complex_code_tasks_2026-05-05/COMPLEX_CODE_TASK_BENCHMARK.md`

## Quickstart: MCP

```bash
npm install
npx playwright install chromium
LOCALQA_PUBLIC_SURFACE=agent-strict npm run localqa:mcp
```

In strict public mode, the main agent sees one tool:

```text
local_agent_run
```

Good user prompt:

```text
Use LocalQA to analyze ./logs/dev.log and return only verified auth/session errors.
```

Bad user prompt:

```text
Here are 50,000 characters of logs pasted directly into cloud chat...
```

If the user pastes raw evidence into cloud chat, it has already gone to the cloud. LocalQA works best when given paths, URLs, tasks, or local evidence handles.

## Quickstart: OpenCode plugin

The repo includes:

```text
opencode.json
.opencode/plugins/localqa.ts
.opencode/tools/local_agent_run.ts
.opencode/tools/answer_from_handle.ts
.opencode/LOCALQA_RULES.md
```

Run OpenCode from the repo root so it loads the LocalQA plugin and rules.

OpenCode adds:

| Feature | Value |
|---|---|
| `local_agent_run` | Native local sidecar agent tool |
| `answer_from_handle` | Ask scoped questions over local vault handles |
| plugin hooks | Compact large/noisy tool output |
| rules file | Pushes the main model toward LocalQA before raw evidence handling |
| env hook | Injects Bonsai/LocalQA runtime settings |

## Safe public claim

LocalQA helps frontier coding agents use less context by collecting, compressing, remembering, and verifying local evidence before the model reasons or implements.

In the initial alpha, Bonsai is the local worker model used for the local evidence path.

## Claims to avoid

Do not claim:

- LocalQA replaces frontier models.
- Bonsai replaces frontier models.
- LocalQA intercepts the first cloud prompt.
- LocalQA prevents data leakage if the user pastes raw data directly into cloud chat.
- LocalQA proves patch correctness.
- Browser QA is permission-free on every machine.

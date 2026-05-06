# LocalQA Launch Packet for May 6, 2026

Launch posture: `v0.1 alpha` / technical preview.

LocalQA is a local evidence and memory layer for frontier coding agents. It helps GPT/Claude/Codex/OpenCode-style agents spend less context on raw logs, repo scans, browser dumps, and forgotten prior work.

For the initial release, LocalQA is designed around Bonsai as the local worker model for evidence triage, cleanup, memory, and handoff preparation. The frontier model still plans and writes code; Bonsai handles noisy local evidence before the frontier model sees a compact verified report.

It does not replace frontier models. It helps manage them better.

## Launch objective

Get technically serious developers to understand one idea:

> Frontier coding agents should reason and implement. LocalQA should collect, compress, remember, and verify local evidence before the frontier model spends expensive context on it.

## Core message

Coding agents waste context on noisy evidence work:

- raw logs
- repo scans
- browser traces
- DOM snapshots
- repeated tool outputs
- forgotten previous attempts

LocalQA adds a local layer that:

- runs through one MCP/OpenCode tool: `local_agent_run`
- uses Bonsai as the local worker model for evidence triage and cleanup
- executes directed local steps planned by the frontier model
- compresses long evidence locally
- writes local project memory
- supports strict tool control
- returns compact evidence, token savings, and next reads

## Strongest launch claims

Use these in this order.

| Claim | Number | Source |
|---|---:|---|
| Real OpenCode provider telemetry input reduction | `53.39%` | `reports/localqa/provider_telemetry_2026-05-05/OPENCODE_PROVIDER_TELEMETRY_AB.md` |
| A/B proxy vs targeted normal-agent evidence | `74.04%` reduction | `reports/localqa/ab_agent_workflows_2026-05-05/AB_AGENT_WORKFLOW_BENCHMARK.md` |
| Multi-step agentic workflow compression | `94.37%` reduction | `reports/localqa/agentic_workflows_2026-05-05/AGENTIC_WORKFLOW_BENCHMARK.md` |
| Long-horizon 300k simulation | `302,772 -> 8,842` tokens, `97.08%` reduction | `reports/localqa/long_horizon_300k_2026-05-05/LONG_HORIZON_300K_BENCHMARK.md` |
| Full launch check | pass | `reports/localqa/launch_check_2026-05-05/LOCALQA_LAUNCH_CHECK.md` |
| Full test suite | `81/81` pass | `npm run localqa:launch-check` |

## Exact safe public claim

> LocalQA is a local evidence and memory layer for frontier coding agents. In a real OpenCode provider-telemetry A/B on a Fastify evidence task, LocalQA reduced fresh input tokens by `53.39%`. In a reproducible A/B proxy against targeted normal-agent evidence collection, it reduced context by `74.04%` while preserving quality gates on `3/3` pre-implementation coding workflows.

> For the initial alpha, LocalQA uses Bonsai as the local worker model. The claim is not that Bonsai replaces GPT/Claude/Codex; the claim is that Bonsai can help process local evidence before the frontier model spends context on it.

## What not to claim

Do not claim:

- LocalQA replaces frontier models.
- LocalQA intercepts the first prompt before it reaches the cloud.
- LocalQA prevents leakage if users paste raw data into cloud chat.
- LocalQA proves final patch correctness.
- Browser QA works on every machine without permission issues.
- The `97%` long-horizon number is provider-billed token savings.

## Launch checklist

Do these before posting.

- Run `npm run localqa:launch-check`.
- Confirm the command exits with `ok: true`.
- Open `LOCALQA_PUBLIC_ALPHA_README.md` and confirm the numbers match the launch check.
- Open `reports/localqa/provider_telemetry_2026-05-05/OPENCODE_PROVIDER_TELEMETRY_AB.md`.
- Prepare one terminal screenshot showing `npm run localqa:launch-check` output.
- Prepare one screenshot of the provider telemetry report table.
- Do not edit code after the final launch check unless rerunning it.

## 60-second demo script

Title: LocalQA: local evidence and memory for frontier coding agents

1. Show the problem.

```text
Coding agents waste context reading raw logs, repo scans, browser traces, and prior work.
```

2. Show the one-tool interface.

```text
The frontier model calls one tool: local_agent_run.
It can use directed mode, so the frontier model still plans the work.
LocalQA executes locally, using Bonsai as the local worker model for evidence cleanup and triage.
```

3. Show directed example.

```json
{
  "controlMode": "directed",
  "task": "Plan a Fastify validation/error response change.",
  "directedSteps": [
    { "tool": "memory_query", "question": "What did we already try?" },
    { "tool": "context_cleanup", "filePath": "./raw-codebase-evidence.txt", "contextBudgetTokens": 1400 }
  ]
}
```

4. Show proof.

```text
OpenCode provider telemetry A/B:
Raw attachment: 25,850 input tokens
LocalQA directed: 12,048 input tokens
Fresh input reduction: 53.39%
```

5. Show long-horizon proof.

```text
Long-horizon simulation:
302,772 raw tokens -> 8,842 compact tokens
9/9 quality gates passed
9/9 phases wrote memory
```

6. Close.

```text
LocalQA does not replace frontier models.
It gives them a Bonsai-backed local evidence and memory layer so they can reason over better context.
```

## X / Twitter launch post

```text
Launching LocalQA v0.1 alpha.

It is a local evidence + memory layer for frontier coding agents.

The goal is not to replace GPT/Claude/Codex.
The goal is to stop wasting their context on raw logs, repo scans, browser dumps, and forgotten prior work.

One tool: local_agent_run
- directed local execution
- context compression
- project memory
- strict tool control
- handoff redaction

Real OpenCode provider telemetry A/B:
Raw Fastify evidence attachment: 25,850 input tokens
LocalQA-directed run: 12,048 input tokens
Fresh input reduction: 53.39%

Reproducible A/B proxy vs targeted normal-agent evidence:
25,829 -> 6,704 tokens
74.04% reduction
quality gates passed on 3/3 tasks

Long-horizon simulation:
302,772 -> 8,842 tokens
97.08% reduction
9/9 quality gates passed
9/9 phases wrote local memory

Caveat: this is alpha. It does not intercept text you paste directly into cloud chat, does not replace frontier models, and does not prove patch correctness.

It is a local control layer for better agent context.
```

## LinkedIn launch post

```text
I’m launching LocalQA v0.1 alpha: a local evidence and memory layer for frontier coding agents.

The problem I kept running into: coding agents are powerful, but they waste a lot of expensive context on low-value evidence work: raw logs, repo scans, browser traces, DOM dumps, repeated terminal output, and rediscovering what was already tried yesterday.

LocalQA adds a local layer between the frontier model and noisy evidence.

The frontier model still plans and implements.
LocalQA runs local evidence work, compresses it, writes project memory, and returns compact context.

Current capabilities:
- one-tool MCP/OpenCode surface: local_agent_run
- directed execution where the main model specifies exact steps
- strict tool mode
- local project memory
- log/repo/browser evidence cleanup
- handoff redaction
- reproducible launch checks

Some numbers from the current launch check:

Real OpenCode provider telemetry A/B:
- raw Fastify evidence attachment: 25,850 input tokens
- LocalQA-directed run: 12,048 input tokens
- fresh input-token reduction: 53.39%

A/B proxy against targeted normal-agent evidence:
- 25,829 -> 6,704 tokens
- 74.04% reduction
- quality gates passed on 3/3 tasks

Long-horizon simulation:
- 302,772 -> 8,842 tokens
- 97.08% reduction
- quality gates passed on 9/9 phases
- memory written on 9/9 phases

This does not replace frontier models. It makes them easier to use well by giving them cleaner local context and memory.

Alpha caveats: it does not intercept data pasted directly into cloud chat, and compression benchmarks are not patch-correctness benchmarks.

But the direction is clear: agents need local context infrastructure, not just bigger models.
```

## Hacker News / Reddit post

```text
Show HN: LocalQA, a local evidence and memory layer for frontier coding agents

I built LocalQA because I kept seeing coding agents waste context on raw logs, repo scans, browser traces, and repeated evidence collection.

The idea is simple: the frontier model should plan and implement. A local layer should collect, compress, remember, and verify evidence before it reaches the main model.

LocalQA exposes one tool: local_agent_run.

It supports:
- directed execution, where the frontier model specifies exact local steps
- strict mode, where unknown tools are rejected
- local project memory
- log/context cleanup
- browser QA hooks
- handoff redaction
- OpenCode plugin support

Current benchmark results:

1. Real OpenCode provider telemetry A/B on a Fastify evidence task
- raw evidence attachment: 25,850 input tokens
- LocalQA-directed run: 12,048 input tokens
- fresh input reduction: 53.39%

2. A/B proxy vs targeted normal-agent evidence
- 25,829 -> 6,704 tokens
- 74.04% reduction
- quality gates passed on 3/3 tasks

3. Long-horizon 300k simulation
- 302,772 -> 8,842 tokens
- 97.08% reduction
- quality gates passed on 9/9 phases

Important caveats:
- It does not replace the frontier model.
- It does not intercept text pasted directly into cloud chat.
- It does not prove final patch correctness.
- Browser QA can be environment-specific.

I’m launching this as an alpha because I think coding agents need local context infrastructure: memory, evidence management, and tool-output compression.
```

## Short demo caption

```text
A frontier coding model should not spend 25k input tokens reading raw evidence when a local layer can compress it first.

LocalQA v0.1 alpha:
- one local_agent_run tool
- directed local execution
- local project memory
- evidence compression
- OpenCode provider telemetry: 53.39% fresh input-token reduction in one Fastify task
```

## FAQ

### Is this another coding agent?

No. It is a local evidence and memory layer for existing frontier coding agents.

### Does it replace GPT/Claude/Codex?

No. The frontier model still plans and implements. LocalQA handles local evidence work.

### Does it stop my first prompt from going to the cloud?

No. If you paste data directly into a cloud chat, it goes to the cloud. LocalQA works when the agent is given local paths, URLs, or tasks and calls `local_agent_run`.

### What is the most defensible number?

The provider telemetry A/B: `25,850` input tokens for raw attachment vs `12,048` input tokens with LocalQA, a `53.39%` fresh input-token reduction on one controlled Fastify task.

### What is the most impressive number?

The long-horizon simulation: `302,772 -> 8,842` tokens, `97.08%` reduction, `9/9` quality gates passed.

### What number should be used carefully?

The `97%` numbers. They measure local evidence/context reduction, not provider-billed token savings.

### What is the wedge?

Agent context management. LocalQA helps the main model receive cleaner context, remember prior work, and avoid repeated raw evidence collection.

## Objection handling

### “A normal agent would grep instead of reading full evidence.”

Correct. That is why the launch includes an A/B proxy against targeted normal-agent evidence, not only full-dump compression. That benchmark showed `74.04%` reduction while preserving quality gates on `3/3` tasks.

### “This does not prove better final code.”

Correct. Current launch proves evidence management and context reduction, not patch correctness. Patch-quality A/B is a next benchmark.

### “Why not just use a bigger context window?”

Bigger context does not solve noisy context, repeated evidence, or forgotten project history. LocalQA is about making the context higher quality and persistent.

### “Is this private?”

Raw local files stay local when LocalQA reads paths and returns compact output. But text pasted directly into a cloud chat is already sent before LocalQA can help.

### “Why MCP/OpenCode?”

MCP gives broad compatibility. OpenCode plugin hooks give stronger enforcement: tool-output compaction, rules, and session compaction context.

## Launch morning sequence

Target: May 6, 2026 morning.

1. Run final proof command.

```bash
npm run localqa:launch-check
```

2. Confirm `ok: true`.

3. Record 60-second terminal demo:

- show `LOCALQA_PUBLIC_ALPHA_README.md`
- show `npm run localqa:launch-check`
- show provider telemetry table
- show long-horizon table

4. Post X thread.

5. Post LinkedIn.

6. Post HN/Reddit only if you have a public repo link ready.

7. Reply to comments with caveats, not hype.

8. Track feedback in a new file:

```text
reports/localqa/LAUNCH_FEEDBACK_2026-05-06.md
```

## Final pre-launch command

```bash
npm run localqa:launch-check
```

If this fails, do not post numbers until fixed and rerun.

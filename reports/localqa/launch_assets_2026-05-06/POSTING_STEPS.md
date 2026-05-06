# LocalQA Posting Steps

Use curiosity-first posts, not flat launch announcements.

## Primary hook

```text
Have you thought about giving Claude/Codex/OpenCode its own free local agent?
```

## Primary asset

Use this image first:

```text
assets/localqa-agent-for-agents.png
```

Use the terminal video only as secondary proof.

## X launch flow

1. Create a new X post.
2. Paste `reports/localqa/launch_assets_2026-05-06/x_post.txt`.
3. Attach `assets/localqa-agent-for-agents.png`.
4. Post.
5. Reply to your own post with `reports/localqa/launch_assets_2026-05-06/x_reply_benchmark.txt`.
6. Attach `assets/localqa-benchmark-chart.png` to the reply.
7. Pin the launch post if it starts getting engagement.

## LinkedIn launch flow

1. Create a new LinkedIn post.
2. Paste `reports/localqa/launch_assets_2026-05-06/linkedin_post.txt`.
3. Attach `assets/localqa-agent-for-agents.png`.
4. Post.
5. Immediately comment with `reports/localqa/launch_assets_2026-05-06/linkedin_first_comment.txt`.
6. If possible, pin or keep that comment visible.

## HN / Reddit flow

Post only after X and LinkedIn are live.

Title:

```text
Show HN: LocalQA - agent for your agents
```

Body:

```text
reports/localqa/launch_assets_2026-05-06/hn_reddit_post.txt
```

Do not attach the terminal video. Use the GitHub link and let the README/images explain the project.

## Follow-up replies

If someone asks whether this replaces Claude/Codex:

```text
No. The frontier model still plans and writes code. LocalQA is a local sidecar for evidence, memory, logs, browser QA, and handoff cleanup.
```

If someone asks about privacy:

```text
It is local-first when used with paths/URLs/tasks. If you paste raw logs directly into cloud chat, they already went to the cloud. LocalQA helps prevent future raw evidence dumps by routing local evidence through local_agent_run.
```

If someone asks MCP vs OpenCode:

```text
MCP is the portable default. OpenCode plugin is the deeper native workflow with tools, rules, hooks, vault handles, and answer_from_handle.
```

If someone asks for proof:

```text
The strongest proof is provider telemetry A/B: 25,850 input tokens vs 12,048 input tokens, a 53.39% fresh input-token reduction on one controlled OpenCode task. Full reports are in the repo.
```

## Claims to avoid

Do not claim:

- LocalQA replaces frontier models.
- LocalQA intercepts pasted cloud prompts.
- LocalQA proves patch correctness.
- 97.08% is provider-billed token savings.

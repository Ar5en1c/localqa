# LocalQA May 6 Launch Plan

Launch today as a public alpha if a public repo/link is available.

## Launch order

1. Run final check.

```bash
npm run localqa:launch-check
```

2. Confirm proof video exists.

```text
reports/localqa/launch_assets_2026-05-06/localqa-alpha-launch-proof.mov
```

3. Publish or share the repo/docs link.

4. Post X and LinkedIn with the proof video.

5. Post HN/Reddit only after the repo/docs are public-readable.

6. Track feedback.

```text
reports/localqa/LAUNCH_FEEDBACK_2026-05-06.md
```

## What to launch

Launch both surfaces, but phrase them correctly:

```text
LocalQA is MCP-first, with an OpenCode plugin integration.
```

MCP is the primary public interface. OpenCode is the stronger native workflow for OpenCode users.

## Final launch post

Use:

```text
Launching LocalQA v0.1 alpha.

LocalQA is a local evidence + memory layer for frontier coding agents.

It uses Bonsai as the local worker model for evidence triage, cleanup, memory, and handoff preparation.

The frontier model still plans and writes code. Bonsai handles noisy local evidence before the frontier model sees a compact verified report.

Launch proof:
- 53.39% fewer fresh input tokens in one real OpenCode provider telemetry A/B test
- 74.04% reduction in controlled A/B workflow benchmark, 3/3 quality gates maintained
- 302,772 -> 8,842 tokens in long-horizon benchmark, 9/9 quality gates, 9/9 memory writes

Not a frontier-model replacement. Not magic privacy. A practical local layer to help coding agents waste less context.
```

## Freeze rule

After final launch check passes, do not add features before posting. Fix only blockers.

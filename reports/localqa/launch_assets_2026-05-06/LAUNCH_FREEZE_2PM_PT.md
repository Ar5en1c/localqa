# LocalQA Launch Freeze Record

Freeze time: 2026-05-05 2 PM PT window
Status: launch-ready alpha, video copied into launch assets

## Final verification

Command run:

```bash
npm run localqa:launch-check
```

Result: PASS

Passed checks:

- syntax
- core syntax
- runner syntax
- agent benchmark syntax
- opencode redaction
- mcp validation
- test suite
- agent layer benchmark
- agentic workflow benchmark
- ab agent workflow benchmark
- long horizon 300k benchmark
- complex code benchmark

Security gates:

- strict surface rejection: true
- handoff no-leak: true

## Demo transcript

Command run:

```bash
bash reports/localqa/launch_assets_2026-05-06/terminal_demo.sh | tee reports/localqa/launch_assets_2026-05-06/terminal_demo_transcript.txt
```

Result: PASS

Transcript path:

```text
reports/localqa/launch_assets_2026-05-06/terminal_demo_transcript.txt
```

Video proof path:

```text
reports/localqa/launch_assets_2026-05-06/localqa-alpha-launch-proof.mov
```

## Public claims frozen for launch

Use these claims only:

- LocalQA uses Bonsai as the local worker model for evidence triage, cleanup, memory, and handoff preparation. The frontier model still plans and writes code.
- Provider telemetry A/B: 25,850 baseline input tokens vs 12,048 LocalQA input tokens, saving 13,802 input tokens, 53.39% reduction.
- A/B workflow proxy: 25,829 targeted baseline tokens vs 6,704 LocalQA tokens, saving 19,125 tokens, 74.04% reduction, 3/3 quality gates maintained.
- Long-horizon 300k benchmark: 302,772 raw tokens vs 8,842 compact tokens, saving 293,930 tokens, 97.08% reduction, 9/9 quality gates, 9/9 memory writes.

## Do not claim

- Do not claim LocalQA replaces frontier models.
- Do not claim Bonsai replaces frontier models.
- Do not claim LocalQA intercepts prompts pasted directly into cloud chat.
- Do not claim LocalQA proves final patch correctness.
- Do not claim 97.08% is provider-billed token savings.
- Do not claim every browser environment is permission-free.

## Launch positioning

LocalQA is a local evidence and memory layer for frontier coding agents.
The frontier model still plans and implements. LocalQA collects, compresses, remembers, and verifies local evidence so the frontier model sees less noisy context.

## Tomorrow morning checklist

1. Run `npm run localqa:launch-check` one final time.
2. Record a 90-120 second screen capture using `terminal_demo.sh`.
3. Publish the README/launch packet.
4. Post prepared X, LinkedIn, and HN/Reddit drafts.
5. Track feedback and bugs in `reports/localqa/LAUNCH_FEEDBACK_2026-05-06.md`.

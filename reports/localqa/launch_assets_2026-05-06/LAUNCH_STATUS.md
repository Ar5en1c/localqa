# LocalQA Launch Status - Ready

Date prepared: 2026-05-05 PT
Launch target: 2026-05-06 morning PT

## Final proof command

`npm run localqa:launch-check`

Status: passed after launch assets were created.

## Assets ready

- `LOCALQA_LAUNCH_PACKET_2026-05-06.md`
- `LOCALQA_PUBLIC_ALPHA_README.md`
- `reports/localqa/launch_assets_2026-05-06/localqa-alpha-launch-proof.mov`
- `reports/localqa/launch_assets_2026-05-06/terminal_demo.sh`
- `reports/localqa/launch_assets_2026-05-06/terminal_demo_transcript.txt`
- `reports/localqa/launch_assets_2026-05-06/x_post.txt`
- `reports/localqa/launch_assets_2026-05-06/linkedin_post.txt`
- `reports/localqa/launch_assets_2026-05-06/hn_reddit_post.txt`
- `reports/localqa/LAUNCH_FEEDBACK_2026-05-06.md`

## Do tomorrow

1. Run `npm run localqa:launch-check` once.
2. Optional: run `reports/localqa/launch_assets_2026-05-06/terminal_demo.sh` for a live terminal demo.
3. Post X.
4. Post LinkedIn.
5. Post HN/Reddit only if public repo/link is ready.
6. Track replies in `reports/localqa/LAUNCH_FEEDBACK_2026-05-06.md`.

## Claims to use

- LocalQA uses Bonsai as the local worker model for evidence triage, cleanup, memory, and handoff preparation.
- OpenCode provider telemetry A/B: `53.39%` fresh input-token reduction.
- A/B proxy: `74.04%` reduction vs targeted normal-agent evidence with `3/3` quality gates passing.
- Long-horizon 300k: `302,772 -> 8,842`, `97.08%` reduction with `9/9` quality gates passing.

## Claims to avoid

- Replaces frontier models.
- Bonsai replaces frontier models.
- Intercepts first cloud prompt.
- Prevents leakage if user pastes raw data into cloud chat.
- Proves patch correctness.

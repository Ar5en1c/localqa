# LocalQA Public Release Manifest

This repo is launchable today as a LocalQA alpha. Use this manifest to keep the public story, included files, and excluded local artifacts clear.

## Public launch surfaces

Launch both surfaces with this phrasing:

```text
LocalQA is MCP-first, with an OpenCode plugin integration.
```

- MCP is the primary public interface.
- OpenCode plugin is the advanced host integration.
- Bonsai is the local worker model for the initial alpha.
- Frontier models still plan and implement.

## Public files to highlight

- `README.md`
- `LOCALQA_PUBLIC_ALPHA_README.md`
- `LOCALQA_LAUNCH_PACKET_2026-05-06.md`
- `docs/LOCALQA_INSTALL_AND_USAGE.md`
- `docs/LOCALQA_BENCHMARKS_AND_CLAIMS.md`
- `docs/LOCALQA_SECURITY_AND_PRIVACY.md`
- `docs/LOCALQA_LAUNCH_TODAY.md`
- `localqa/README.md`
- `localqa/`
- `.opencode/plugins/localqa.ts`
- `.opencode/tools/local_agent_run.ts`
- `.opencode/tools/answer_from_handle.ts`
- `.opencode/LOCALQA_RULES.md`
- `opencode.json`
- `scripts/localqa_launch_check.mjs`
- `scripts/bench_localqa_ab_agent_workflows.mjs`
- `scripts/bench_localqa_long_horizon_300k.mjs`
- `scripts/bench_localqa_agentic_workflows.mjs`
- `scripts/bench_opencode_provider_telemetry_ab.mjs`
- `reports/localqa/launch_assets_2026-05-06/terminal_demo_transcript.txt`
- `reports/localqa/launch_assets_2026-05-06/x_post.txt`
- `reports/localqa/launch_assets_2026-05-06/linkedin_post.txt`

## Do not publish as source

These are local/runtime artifacts and should not be committed or packaged as source:

- `.opencode/vault-runs/`
- `.opencode/tmp/`
- `reports/localqa/context-index/`
- raw browser traces/HARs/zips
- local screen recordings such as `*.mov`
- local model files
- private worktrees such as `jobtracker-mlc-lab-worktree/`

## Final command before public post

```bash
npm run localqa:launch-check
```

Post only after it exits with `"ok": true`.

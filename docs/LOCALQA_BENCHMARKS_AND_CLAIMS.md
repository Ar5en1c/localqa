# LocalQA Benchmarks and Public Claims

LocalQA is an agent for your agents: a local Bonsai-backed sidecar that helps frontier coding agents use less context on evidence, memory, and cleanup work.

This document separates claim-safe launch numbers from things LocalQA does not prove yet.

## Benchmark summary

| Benchmark | Baseline/raw | LocalQA compact | Saved | Reduction | What it proves |
|---|---:|---:|---:|---:|---|
| Real OpenCode provider telemetry A/B | `25,850` input tokens | `12,048` input tokens | `13,802` | `53.39%` | Provider-observed fresh input reduction on one controlled task |
| A/B workflow proxy | `25,829` tokens | `6,704` tokens | `19,125` | `74.04%` | Compact evidence preserved `3/3` task quality gates |
| Agentic workflows | `100,924` tokens | `5,685` tokens | `95,239` | `94.37%` | Multi-step workflow evidence compression with `3/3` passing quality |
| Long-horizon 300k | `302,772` tokens | `8,842` tokens | `293,930` | `97.08%` | Long-task memory/evidence compression with `9/9` quality gates |
| Complex OSS scout | `100,952` tokens | `2,606` tokens | `98,346` | `97.42%` | Source/test/risk orientation survived compacting on `3/3` OSS tasks |

## Visual chart

![LocalQA benchmark chart](../assets/localqa-benchmark-chart.svg)

## Final launch check

Command:

```bash
npm run localqa:launch-check
```

Latest status used for launch: pass.

Passed gates include syntax checks, runner checks, redaction smoke, MCP validation, test suite, agent-layer benchmark, agentic workflow benchmark, A/B workflow benchmark, long-horizon benchmark, and complex code benchmark.

## Claim-safe numbers

### Real OpenCode provider telemetry A/B

Source:

```text
reports/localqa/provider_telemetry_2026-05-05/OPENCODE_PROVIDER_TELEMETRY_AB.md
```

Result:

- baseline raw evidence run: `25,850` input tokens
- LocalQA-directed run: `12,048` input tokens
- input tokens saved: `13,802`
- input reduction: `53.39%`

This is the strongest provider-facing claim. It is one controlled OpenCode run, not a universal average.

### A/B workflow proxy

Source:

```text
reports/localqa/ab_agent_workflows_2026-05-05/AB_AGENT_WORKFLOW_BENCHMARK.md
```

Result:

- targeted normal-agent evidence: `25,829` tokens
- LocalQA compact path: `6,704` tokens
- saved: `19,125` tokens
- reduction: `74.04%`
- quality gates maintained: `3/3`

This is a reproducible proxy benchmark, not provider billing telemetry.

### Long-horizon 300k benchmark

Source:

```text
reports/localqa/long_horizon_300k_2026-05-05/LONG_HORIZON_300K_BENCHMARK.md
```

Result:

- raw evidence: `302,772` tokens
- compact evidence: `8,842` tokens
- saved: `293,930` tokens
- reduction: `97.08%`
- quality gates: `9/9`
- memory writes: `9/9`

This proves LocalQA can compress and preserve structured long-task memory. It does not prove provider-billed savings by itself.

## Safe launch language

Use:

```text
LocalQA is an agent for your agents: a local Bonsai-backed sidecar that helps frontier coding agents collect, compress, remember, and verify local evidence before reasoning or implementation.
```

Use:

```text
LocalQA uses Bonsai as the local worker model for evidence triage, cleanup, memory, and handoff preparation. The frontier model still plans and writes code.
```

## Claims to avoid

Do not claim:

- LocalQA replaces frontier models.
- Bonsai replaces frontier models.
- LocalQA intercepts text pasted directly into cloud chat.
- LocalQA proves final patch correctness.
- The `97.08%` long-horizon number is provider-billed token savings.
- Browser QA is permission-free on every machine.

## Reproduction commands

```bash
npm run localqa:launch-check
npm run localqa:bench:ab-agent-workflows
npm run localqa:bench:long-horizon-300k
npm run localqa:bench:agentic-workflows
npm run localqa:bench:complex-code-tasks
```

Provider telemetry:

```bash
npm run localqa:bench:provider-telemetry
```

Provider telemetry depends on local OpenCode/provider credentials and may not run in every environment.

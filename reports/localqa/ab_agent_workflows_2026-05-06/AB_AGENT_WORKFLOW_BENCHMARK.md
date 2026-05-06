# LocalQA A/B Agent Workflow Benchmark

Date: 2026-05-06T17:17:48.910Z

## Purpose

This benchmark addresses the skeptic objection: compression against a full evidence dump is not enough, because a normal frontier agent would often grep/read selectively instead of ingesting the full dump.

So this A/B benchmark compares:

- Baseline A: a realistic targeted normal-agent evidence path built from package/tree/grep/excerpt-style evidence, not the full raw file.
- LocalQA B: one directed local_agent_run call that queries memory, compresses long evidence, runs a targeted follow-up, writes memory, and returns compact context.

This measures the pre-implementation evidence task. It does not claim final patch correctness.

## Aggregate

- Cases: 3
- Targeted baseline tokens: 25829
- LocalQA tokens: 6704
- Saved vs targeted baseline: 19125 tokens
- Reduction vs targeted baseline: 74.04%
- Baseline quality pass: 3/3
- LocalQA quality pass: 3/3
- LocalQA maintained or improved quality within tolerance: 3/3
- Estimated main-agent tool-call reduction: 15

## Results

| Task | Baseline toks | LocalQA toks | Saved | Reduction | Baseline quality | LocalQA quality | Delta | Both pass | Tool calls saved |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Fastify validation/error contract pre-implementation plan | 9114 | 2258 | 6856 | 75.22% | 1 | 1 | 0 | yes | 5 |
| Express router/middleware pre-implementation plan | 7608 | 2223 | 5385 | 70.78% | 0.953 | 0.925 | -0.028 | yes | 5 |
| Zod schema/parser pre-implementation plan | 9107 | 2223 | 6884 | 75.59% | 1 | 1 | 0 | yes | 5 |

## Interpretation

This is the stronger claim than raw compression: against a targeted normal-agent evidence baseline, LocalQA still reduces context while preserving deterministic evidence quality gates.

The measured improvement is not billed-token proof from an actual provider session. It is a reproducible local proxy for the amount of evidence that would be handed to the frontier model in each workflow. Real billed savings depend on the agent host, model provider, and how aggressively the baseline agent would search/read files.

## Public-safe claim

In this A/B proxy benchmark, LocalQA reduced targeted normal-agent evidence context by 74.04% while preserving quality gates on 3/3 pre-implementation evidence tasks.

## What this still does not prove

- It does not prove final patch correctness.
- It does not measure actual provider-billed tokens from OpenCode session logs.
- It does not prove the frontier model would always choose exactly the same baseline reads.
- It does not replace a live A/B session transcript. It is the reproducible benchmark we can ship before collecting provider-level traces.

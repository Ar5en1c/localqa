# LocalQA Long-Horizon 300k Benchmark

Date: 2026-05-06T17:17:50.244Z

## Purpose

This benchmark simulates a longer project across repeated sessions. It runs 9 directed LocalQA phases across 3 real OSS evidence bundles and 3 project phases: orientation, implementation planning, and regression review.

The raw baseline is the amount of evidence a long-running agent could repeatedly expose across sessions if it re-collects or re-reads similar repo evidence. LocalQA instead queries project memory, compresses local evidence, records phase memory, and returns compact context for the frontier model.

This benchmark targets roughly 300k total raw evidence tokens.

## Aggregate

- Phases: 9
- Projects: 3
- Raw baseline tokens: 302772
- LocalQA compact tokens: 8842
- Saved tokens: 293930
- Reduction: 97.08%
- Average quality score: 0.976
- Passing phases: 9/9
- Total runtime: 972.37ms
- Average runtime per phase: 108.04ms
- Memory-writing phases: 9/9

## Project summaries

| Project | Raw toks | Compact toks | Saved toks | Reduction | Avg quality | Pass |
|---|---:|---:|---:|---:|---:|---:|
| Fastify validation/error contract migration | 125544 | 2979 | 122565 | 97.63% | 1 | 3/3 |
| Express router/middleware behavior change | 71808 | 2938 | 68870 | 95.91% | 0.928 | 3/3 |
| Zod schema/parser type-surface change | 105420 | 2925 | 102495 | 97.23% | 1 | 3/3 |

## Phase results

| Project | Phase | Raw toks | Compact toks | Saved toks | Reduction | Runtime ms | Quality | Label | Memory |
|---|---|---:|---:|---:|---:|---:|---:|---|---:|
| Fastify validation/error contract migration | Day 1 orientation | 41848 | 938 | 40910 | 97.76% | 98.68 | 1 | strong | yes |
| Fastify validation/error contract migration | Day 2 implementation plan | 41848 | 1001 | 40847 | 97.61% | 100.86 | 1 | strong | yes |
| Fastify validation/error contract migration | Day 3 regression review | 41848 | 1040 | 40808 | 97.51% | 102.29 | 1 | strong | yes |
| Express router/middleware behavior change | Day 1 orientation | 23936 | 935 | 23001 | 96.09% | 110.59 | 0.928 | strong | yes |
| Express router/middleware behavior change | Day 2 implementation plan | 23936 | 976 | 22960 | 95.92% | 105.79 | 0.928 | strong | yes |
| Express router/middleware behavior change | Day 3 regression review | 23936 | 1027 | 22909 | 95.71% | 108.85 | 0.928 | strong | yes |
| Zod schema/parser type-surface change | Day 1 orientation | 35140 | 921 | 34219 | 97.38% | 119.32 | 1 | strong | yes |
| Zod schema/parser type-surface change | Day 2 implementation plan | 35140 | 976 | 34164 | 97.22% | 111.99 | 1 | strong | yes |
| Zod schema/parser type-surface change | Day 3 regression review | 35140 | 1028 | 34112 | 97.07% | 114 | 1 | strong | yes |

## Interpretation

This is a stronger long-horizon test than a one-shot compression benchmark because every phase includes memory query + evidence compression + memory record. It demonstrates the intended product behavior: the frontier model can keep working with compact project state instead of repeatedly dragging long raw evidence into context.

## Public-safe claim

In a 9-phase long-horizon benchmark totaling 302772 raw evidence tokens, LocalQA returned 8842 compact tokens, saving 293930 tokens (97.08% reduction), with quality gates passing on 9/9 phases.

## Caveats

- This measures local evidence/context handed to the frontier model, not provider-billed OpenCode token telemetry.
- It does not prove final patch correctness.
- It simulates repeated long-horizon evidence usage across sessions; actual savings depend on how often a baseline agent would re-read or re-collect evidence.

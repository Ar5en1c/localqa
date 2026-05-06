# LocalQA Complex Code Task Benchmark

Date: 2026-05-06T17:17:51.468Z

## Purpose

This benchmark tests whether LocalQA compact evidence is useful for complex code tasks, not just small. It uses real OSS codebase evidence bundles and scores whether compact output preserves source areas, test commands, package signals, and maintenance-risk signals a frontier coding model would need before planning a patch.

This is a frontier-model-support benchmark, not a replacement-model benchmark. LocalQA is evaluated as the local evidence worker that feeds the main model smaller, targeted context.

## Summary

- Tasks: 3
- Single-pass profiles: 9
- Frontier-ready single-pass profiles: 9/9
- Recommended total: 100952 raw tokens -> 2606 compact tokens, 97.42% reduction.
- Recommended strategy: use the smallest profile that preserves both broad signals and actionability gates; follow with targeted handle/file reads before editing.

## Token savings by profile

| Profile | Raw toks | Compact toks | Saved toks | Reduction | Frontier-ready |
|---|---:|---:|---:|---:|---:|
| single 800 | 100952 | 2606 | 98346 | 97.42% | 3/3 |
| single 1600 | 100952 | 5009 | 95943 | 95.04% | 3/3 |
| single 3200 | 100952 | 9817 | 91135 | 90.28% | 3/3 |

## Single-pass results

| Project | Task category | Profile | Raw toks | Compact toks | Reduction | Signal score | Actionability | Frontier score | Label | Paths | Test cmds | Signals | Pass |
|---|---|---|---:|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|
| expressjs/express | multi-file orientation + fix planning | single 800 | 23946 | 862 | 96.4% | 1 | 1 | 1 | orientation-ready | 16 | 1 | 6/6 | yes |
| expressjs/express | multi-file orientation + fix planning | single 1600 | 23946 | 1666 | 93.04% | 1 | 1 | 1 | orientation-ready | 26 | 1 | 6/6 | yes |
| expressjs/express | multi-file orientation + fix planning | single 3200 | 23946 | 3270 | 86.34% | 1 | 1 | 1 | orientation-ready | 32 | 1 | 6/6 | yes |
| fastify/fastify | cross-file behavior contract | single 800 | 41857 | 865 | 97.93% | 1 | 1 | 1 | orientation-ready | 14 | 8 | 8/8 | yes |
| fastify/fastify | cross-file behavior contract | single 1600 | 41857 | 1670 | 96.01% | 1 | 1 | 1 | orientation-ready | 28 | 8 | 8/8 | yes |
| fastify/fastify | cross-file behavior contract | single 3200 | 41857 | 3268 | 92.19% | 1 | 1 | 1 | orientation-ready | 32 | 13 | 8/8 | yes |
| colinhacks/zod | library API/type-surface change | single 800 | 35149 | 879 | 97.5% | 1 | 1 | 1 | orientation-ready | 15 | 6 | 7/7 | yes |
| colinhacks/zod | library API/type-surface change | single 1600 | 35149 | 1673 | 95.24% | 1 | 1 | 1 | orientation-ready | 23 | 12 | 7/7 | yes |
| colinhacks/zod | library API/type-surface change | single 3200 | 35149 | 3279 | 90.67% | 1 | 1 | 1 | orientation-ready | 32 | 12 | 7/7 | yes |

## Two-pass targeted results

| Project | Task category | Compact toks | Reduction | Frontier score | Label | Signals | Pass |
|---|---|---:|---:|---:|---|---:|---:|
| expressjs/express | multi-file orientation + fix planning | n/a | n/a | n/a | n/a | n/a | n/a |
| fastify/fastify | cross-file behavior contract | n/a | n/a | n/a | n/a | n/a | n/a |
| colinhacks/zod | library API/type-surface change | n/a | n/a | n/a | n/a | n/a | n/a |

## Recommended use per task

| Project | Recommended strategy | Compact toks | Reduction | Frontier score | Label |
|---|---|---:|---:|---:|---|
| expressjs/express | single_800 | 862 | 96.4% | 1 | orientation-ready |
| fastify/fastify | single_800 | 865 | 97.93% | 1 | orientation-ready |
| colinhacks/zod | single_800 | 879 | 97.5% | 1 | orientation-ready |

## What the actionability gate checks

- At least 3 path-like source/test/config/doc references.
- At least 1 package/test command signal.
- Separate source-area and test-area signals.
- Package/script metadata.
- At least 2 risk or behavior-contract signals.

## Interpretation

- LocalQA can save large amounts of context while preserving enough task signals for orientation and pre-patch planning.
- 800 tokens is a credible scout pass when actionability gates pass. It is not a patching context by itself.
- 1600 tokens is the practical default when the task is ambiguous or when the user expects the main model to reason about tradeoffs.
- 3200 tokens is safer when the main model must plan edits across multiple files, but it still should use exact file reads before changing code.
- The best UX is not one giant context dump. It is first-pass local overview plus targeted follow-up queries when a signal is missing.

## Limits found

- This does not prove the compact report is enough to implement a patch without reading exact files. For patching, the main model still needs targeted file reads or handle queries.
- The actionability gate measures evidence preservation. It does not grade semantic patch correctness.
- Raw evidence construction is an approximation of what a normal agent would collect through several file/list/grep reads.

## Public-safe claim

For these complex OSS codebase tasks, LocalQA reduced raw codebase evidence by the measured ratios below while preserving a scored set of source/test/build/actionability signals. It is best positioned as a local evidence compressor and task router for frontier coding models, not as a standalone replacement for them.

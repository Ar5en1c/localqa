# LocalQA Agentic Workflow Benchmark

Date: 2026-05-05T21:55:23.453Z

## Purpose

This benchmark tests multi-step, agentic, frontier-model-support workflows. The frontier model owns the plan. LocalQA executes directed local steps: memory query, long-context codebase evidence compression, targeted follow-up extraction, memory recording, and compact output packaging.

It compares a normal raw-context agent path against LocalQA as a local evidence/memory layer. This measures context savings, actionability, quality signals, runtime, and memory behavior. It does not claim patch correctness.

## Aggregate

- Workflows: 3
- Raw baseline context: 100924 tokens
- LocalQA compact context: 5685 tokens
- Saved: 95239 tokens
- Reduction: 94.37%
- Average quality score: 0.927
- Passing quality workflows: 3/3
- Main-agent tool calls: 3 LocalQA calls instead of exposing 100924 raw tokens to the main model.

## Results

| Workflow | Raw toks | LocalQA compact toks | Saved toks | Reduction | Runtime ms | Signal | Actionability | Quality | Label | Memory |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|
| Fastify validation/error contract investigation | 41848 | 1912 | 39936 | 95.43% | 104.4 | 1 | 1 | 1 | strong | yes |
| Express router/middleware investigation | 23936 | 1873 | 22063 | 92.17% | 115.72 | 0.914 | 0.857 | 0.888 | usable | yes |
| Zod schema/parser investigation | 35140 | 1900 | 33240 | 94.59% | 116.55 | 0.925 | 0.857 | 0.894 | usable | yes |

## Normal agent path vs LocalQA path

Normal agent path:

- Main model performs repeated file/list/search/read loops or receives large raw evidence.
- Raw evidence remains in model context unless manually summarized.
- Prior attempts are preserved only if still in chat context.
- Token cost scales with raw logs/repo/browser evidence.

LocalQA path:

- Main model makes one high-level local_agent_run call with directed steps.
- LocalQA queries local memory, compresses long evidence, does targeted follow-up, and writes memory locally.
- Main model receives compact evidence, likely files, commands, risks, and next reads.
- Token cost scales with compact output, not raw evidence size.

## Quality scoring

Quality is deterministic and conservative:

- Signal score checks named task-critical terms.
- Actionability checks path-like evidence, test command evidence, source/test split, memory context, next-read/risk language.
- A passing workflow must score at least 0.75 and preserve at least 67% of must-have signals.

## Public-safe claim

Across these real OSS long-context workflows, LocalQA reduced 100924 raw evidence tokens to 5685 compact tokens (94.37% reduction) while preserving deterministic quality/actionability gates on 3/3 multi-step workflows.

## Limits

- This is evidence/workflow quality, not patch correctness.
- The frontier model still must read exact files before editing.
- Browser QA is not included in this benchmark because browser permissions vary by environment; this benchmark targets reproducible repo evidence workflows.

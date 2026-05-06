# LocalQA Agent Layer Real-Env Benchmark

Date: 2026-05-05T21:55:22.477Z

## Scope

This validates the new LocalQA agent layer in this actual repo environment. It tests directed execution, strict mode rejection, durable memory record/query, redaction-safe handoff output, and a real local OSS codebase evidence file.

## Environment

- Worktree: /Users/kuldeepsingh/MyProjects/qwen2.5-1.5b-turboquant-mlc-experiment
- Evidence file: /Users/kuldeepsingh/MyProjects/qwen2.5-1.5b-turboquant-mlc-experiment/reports/localqa/opencode_oss_codebases_2026-05-05/fastify_fastify/raw-codebase-evidence.txt
- Evidence bytes: 167490
- Evidence approx tokens: 41848
- Output dir: /Users/kuldeepsingh/MyProjects/qwen2.5-1.5b-turboquant-mlc-experiment/reports/localqa/agent_layer_real_env_2026-05-05

## Results

| Test | OK | Control | Mode | Runtime ms | Raw toks | Compact toks | Saved toks | Reduction | Memory | Note |
|---|---:|---|---|---:|---:|---:|---:|---:|---:|---|
| record_memory | yes | record | record_work | 65.53 | n/a | 220 | n/a | n/a% | yes | writes local daily memory |
| directed_memory_plus_codebase_cleanup | yes | directed | directed | 91.21 | 41857 | 843 | 41014 | 97.99% | yes | frontier model specifies exact local steps |
| strict_rejects_unknown_tool | no | strict | directed | 63.75 | n/a | 21 | n/a | n/a% | yes | rejected as expected |
| directed_handoff_redaction | yes | directed | directed | 75.04 | 35 | 65 | 0 | 0% | yes | no runner-output leak |
| query_project_memory | yes | memory | memory | 80.52 | 14431 | 1042 | 13389 | 92.78% | no | reads local memory ledger |

## Findings

- Directed execution works when the frontier model specifies exact local steps.
- Strict mode rejects unknown tools instead of letting LocalQA improvise.
- Project memory can be written and queried locally through the same one-tool surface.
- Sensitive handoff output did not leak the synthetic test secret in the OpenCode-facing runner response.
- The measured token savings are from a real local OSS evidence bundle, not a synthetic tiny prompt.

## Limits

- This benchmark does not open a live browser page. It focuses on the new control layer and local file evidence path.
- It validates orientation/compression/memory. It does not prove patch correctness.

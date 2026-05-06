# OpenCode Provider Token Telemetry A/B

Date: 2026-05-05T06:46:53.775Z

## Purpose

This is the first real provider-telemetry probe. It uses OpenCode's JSON events and session export token fields, not LocalQA's approximate token math.

## Evidence

- Evidence file: /Users/kuldeepsingh/MyProjects/qwen2.5-1.5b-turboquant-mlc-experiment/reports/localqa/opencode_oss_codebases_2026-05-05/fastify_fastify/raw-codebase-evidence.txt
- Evidence bytes: 167490
- Evidence approx tokens: 41848

## Runs

| Run | OK | Session | Runtime ms | Input | Output | Total | Cache read | Cost | Tool calls |
|---|---:|---|---:|---:|---:|---:|---:|---:|---:|
| baseline_raw_attachment_fastify | yes | ses_2091cac14ffe5Q3hUD3SrH1M5d | 11224.73 | 25850 | 439 | 26289 | 0 | 0 | 0 |
| localqa_directed_fastify | yes | ses_2091c7febffecBMBK7jaWV4qpq | 14911.97 | 12048 | 601 | 22377 | 9728 | 0 | 1 |

## Comparison

- Baseline input tokens: 25850
- LocalQA input tokens: 12048
- Input tokens saved: 13802
- Input reduction: 53.39%
- Baseline total tokens: 26289
- LocalQA total tokens: 22377
- Total tokens saved: 3912
- Total reduction: 14.88%

## Caveats

- This is one controlled provider telemetry A/B, not a statistically significant benchmark.
- The baseline attaches raw evidence directly to the model. A highly careful baseline agent could grep/read less, which is why the separate A/B proxy benchmark remains relevant.
- Total tokens include cache-read tokens as reported by OpenCode. Depending on provider pricing, cache-read tokens may be billed at a lower rate than fresh input tokens.
- OpenCode reported cost as provided by the CLI. In this environment cost is $0.00 for these models even though token usage is recorded.

# LocalQA Launch Check

Date: 2026-05-05T21:55:26.904Z

## Verdict

PASS: launch evidence is reproducible in this local environment.

## Commands

| Check | Result | Runtime ms | Command |
|---|---:|---:|---|
| syntax | pass | 64.55 | `node --check localqa/core/project-memory-core.mjs` |
| core syntax | pass | 62.98 | `node --check localqa/core/local-agent-core.mjs` |
| runner syntax | pass | 56.9 | `node --check scripts/localqa-opencode-runner.mjs` |
| agent benchmark syntax | pass | 57.74 | `node --check scripts/bench_localqa_agent_layer.mjs` |
| opencode redaction | pass | 640.09 | `npm run localqa:opencode:redaction` |
| mcp validation | pass | 1114.34 | `npm run localqa:validate` |
| test suite | pass | 5135.55 | `npm test` |
| agent layer benchmark | pass | 804.86 | `npm run localqa:bench:agent-layer` |
| agentic workflow benchmark | pass | 974.53 | `npm run localqa:bench:agentic-workflows` |
| ab agent workflow benchmark | pass | 776.62 | `npm run localqa:bench:ab-agent-workflows` |
| long horizon 300k benchmark | pass | 1371.7 | `npm run localqa:bench:long-horizon-300k` |
| complex code benchmark | pass | 1295.34 | `npm run localqa:bench:complex-code-tasks` |

## Public numbers reproduced

### Complex OSS code tasks

| Budget | Raw toks | Compact toks | Saved toks | Reduction | Frontier-ready |
|---:|---:|---:|---:|---:|---:|
| 800 | 100952 | 2606 | 98346 | 97.42% | 3/3 |
| 1600 | 100952 | 5009 | 95943 | 95.04% | 3/3 |
| 3200 | 100952 | 9817 | 91135 | 90.28% | 3/3 |

### Agent layer real-env path

- Real evidence approx tokens: 41848
- Directed local evidence compression: raw=41857, compact=843, saved=41014, reduction=97.99%
- Directed runtime: 91.21ms
- Strict unknown-tool rejection: pass
- Synthetic secret leak check: pass
- Memory query: raw=14431, compact=1042, saved=13389, reduction=92.78%

### Agentic multi-step workflows

- Aggregate raw tokens: 100924
- Aggregate compact tokens: 5685
- Aggregate saved tokens: 95239
- Aggregate reduction: 94.37%
- Passing quality workflows: 3/3

| Workflow | Raw toks | Compact toks | Saved toks | Reduction | Runtime ms | Quality | Label | Memory |
|---|---:|---:|---:|---:|---:|---:|---|---:|
| Fastify validation/error contract investigation | 41848 | 1912 | 39936 | 95.43% | 104.4 | 1 | strong | yes |
| Express router/middleware investigation | 23936 | 1873 | 22063 | 92.17% | 115.72 | 0.888 | usable | yes |
| Zod schema/parser investigation | 35140 | 1900 | 33240 | 94.59% | 116.55 | 0.894 | usable | yes |

### A/B proxy vs targeted normal-agent evidence

- Targeted baseline tokens: 25829
- LocalQA tokens: 6704
- Saved vs targeted baseline: 19125
- Reduction vs targeted baseline: 74.04%
- Baseline quality pass: 3/3
- LocalQA quality pass: 3/3
- Maintained quality within tolerance: 3/3
- Estimated main-agent tool-call reduction: 15

| Task | Baseline toks | LocalQA toks | Saved | Reduction | Baseline quality | LocalQA quality | Delta | Both pass | Tool calls saved |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Fastify validation/error contract pre-implementation plan | 9114 | 2258 | 6856 | 75.22% | 1 | 1 | 0 | yes | 5 |
| Express router/middleware pre-implementation plan | 7608 | 2223 | 5385 | 70.78% | 0.953 | 0.925 | -0.028 | yes | 5 |
| Zod schema/parser pre-implementation plan | 9107 | 2223 | 6884 | 75.59% | 1 | 1 | 0 | yes | 5 |

### Long-horizon 300k task simulation

- Raw baseline tokens: 302772
- LocalQA compact tokens: 8842
- Saved tokens: 293930
- Reduction: 97.08%
- Passing phases: 9/9
- Average quality score: 0.976
- Memory-writing phases: 9/9

| Project | Raw toks | Compact toks | Saved toks | Reduction | Avg quality | Pass |
|---|---:|---:|---:|---:|---:|---:|
| Fastify validation/error contract migration | 125544 | 2979 | 122565 | 97.63% | 1 | 3/3 |
| Express router/middleware behavior change | 71808 | 2938 | 68870 | 95.91% | 0.928 | 3/3 |
| Zod schema/parser type-surface change | 105420 | 2925 | 102495 | 97.23% | 1 | 3/3 |

## Launch-safe claim

LocalQA is a local evidence and memory layer for frontier coding agents. In this local launch check, it reproduced complex OSS code-task compression, directed Fastify evidence compression, multi-step agentic workflow compression, an A/B proxy against targeted normal-agent evidence, and a 300k-token long-horizon task simulation while preserving strict one-tool MCP behavior, redaction smoke coverage, and the full test suite.

## Do not claim

- Do not claim LocalQA replaces frontier coding models.
- Do not claim it intercepts text already pasted into cloud chat.
- Do not claim the A/B proxy is provider-billed token telemetry; real savings depend on the agent host, provider, and baseline agent behavior.
- Do not claim patch correctness from compression benchmarks alone.
- Do not claim all browser QA works without environment-specific Playwright/browser permissions.

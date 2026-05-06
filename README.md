# LocalQA v0.1 Alpha

LocalQA is a Bonsai-backed local evidence and memory layer for frontier coding agents.

It is MCP-first, with an OpenCode plugin integration for stronger host-layer workflows.

The frontier model still plans and writes code. LocalQA uses Bonsai as the local worker model for evidence triage, cleanup, project memory, and handoff preparation, then returns compact verified context instead of raw logs, repo dumps, browser traces, or forgotten prior work.

## What LocalQA is for

Coding agents waste context on low-value evidence work:

- long logs and stack traces
- repeated repo scans
- browser console/network/DOM dumps
- docs and page extraction
- prior work rediscovery
- noisy tool output
- pre-handoff cleanup and redaction

LocalQA gives the frontier model one local worker surface:

```text
local_agent_run
```

The main model can either ask LocalQA to route automatically or use directed mode and specify the exact local steps to run.

## MCP vs OpenCode

Launch surface:

- MCP: primary public interface. Use this first. It exposes one strict tool, `local_agent_run`, for agent hosts that support MCP.
- OpenCode plugin: advanced integration. It adds OpenCode rules/tools/hooks so LocalQA can compact large tool output, expose vault handles, and preserve local memory through longer sessions.

In short: LocalQA is MCP-first; OpenCode is the stronger native-agent workflow.

## Launch proof

Latest launch check:

```bash
npm run localqa:launch-check
```

Defensible launch numbers:

- Real OpenCode provider telemetry A/B: `25,850` baseline input tokens vs `12,048` LocalQA input tokens, saving `13,802` fresh input tokens, `53.39%` reduction.
- Controlled A/B workflow proxy: `25,829 -> 6,704` tokens, `74.04%` reduction, `3/3` quality gates maintained.
- Long-horizon benchmark: `302,772 -> 8,842` tokens, `97.08%` reduction, `9/9` quality gates, `9/9` memory writes.

Proof assets:

- [Launch packet](./LOCALQA_LAUNCH_PACKET_2026-05-06.md)
- [Public alpha README](./LOCALQA_PUBLIC_ALPHA_README.md)
- [Install guide](./docs/LOCALQA_INSTALL_AND_USAGE.md)
- [Benchmarks and claims](./docs/LOCALQA_BENCHMARKS_AND_CLAIMS.md)
- [Security and privacy boundary](./docs/LOCALQA_SECURITY_AND_PRIVACY.md)
- [Demo transcript](./reports/localqa/launch_assets_2026-05-06/terminal_demo_transcript.txt)

## Quick start: MCP

Install dependencies:

```bash
npm install
npx playwright install chromium
```

Start LocalQA MCP in strict one-tool mode:

```bash
LOCALQA_PUBLIC_SURFACE=agent-strict npm run localqa:mcp
```

Tell your coding agent:

```text
Use LocalQA as the local evidence and memory layer. Before reading large logs, browser evidence, DOM dumps, screenshots, network traces, or repeated repo context, call local_agent_run. Prefer directed mode for complex work.
```

## Quick start: OpenCode

This repo includes:

```text
opencode.json
.opencode/plugins/localqa.ts
.opencode/tools/local_agent_run.ts
.opencode/tools/answer_from_handle.ts
.opencode/LOCALQA_RULES.md
```

Use OpenCode from this repo root so it loads the LocalQA plugin and rules.

## Bonsai runtime

Initial alpha reference path is Bonsai as the local worker model.

Start Bonsai manually if needed:

```bash
npm run localqa:bonsai:serve
```

Or let LocalQA attempt autostart in MCP/OpenCode environments:

```bash
LOCALQA_DEFAULT_LLM=bonsai \
LOCALQA_BONSAI_AUTOSTART=1 \
LOCALQA_LLM_PROVIDER=openai-compatible \
LOCALQA_LLM_ENDPOINT=http://127.0.0.1:18081/v1/chat/completions \
LOCALQA_LLM_MODEL=Bonsai-8B.gguf \
LOCALQA_PUBLIC_SURFACE=agent-strict \
npm run localqa:mcp
```

## Caveats

Do not overread the claims:

- LocalQA does not replace frontier models.
- Bonsai does not replace frontier models.
- LocalQA does not intercept text pasted directly into cloud chat.
- LocalQA does not prove final patch correctness.
- Browser QA can be environment-specific because local browser permissions vary.
- The `97.08%` long-horizon number is a local evidence compression benchmark, not a provider-billed token claim.

---

## Original browser-model lab context

This repository also contains the older WebLLM/MLC browser inference and TurboQuant research lab that led to LocalQA. That historical context remains below.

# WebLLM Bench: Browser-Native GPU Inference & Compilation Harness

**WebLLM Bench** is a rigorous evaluation harness and custom context compiler for on-device Large Language Models. It enables deterministic benchmarking, mathematical A/B comparison, and custom context window compilation (up to 8192 tokens) entirely within the browser via **WebGPU** and **WASM**—requiring zero server-side inference.

### 🏗️ Core Infrastructure & Technical Impact
- ⚡ **Large Context Compilation:** Engineered a custom compilation pipeline to deploy an 8192-context `Qwen2.5-1.5B` model, proving mathematical performance parity with standard 4k baselines on constrained browser hardware.
- 🔬 **Deterministic A/B Benchmarking:** Architected a reactive test harness to measure prefill TPS, decode TPS, TTFT, and token-generation latency (avg + P95) across 136+ dynamically loaded MLC models.
- 🔒 **Zero-Trust Architecture:** Models are securely fetched, cached via IndexedDB/Cache API, and executed natively on the client's local GPU, guaranteeing absolute data privacy (PII never leaves the DOM).

Maintained by **Kuldeep Singh** ([LinkedIn](https://www.linkedin.com/in/kuldeep-5ingh/)). Originally developed as the core inference technology powering **[YouxAI](https://youxai.app)**.

**Live Infrastructure Demo:** [https://ar5en1c.github.io/webllm-bench/](https://ar5en1c.github.io/webllm-bench/)

---

## Current Truth (April 2026)

If you want the current state of the repo rather than older exploratory docs, start here:

- `docs/CURRENT_STATUS_2026-04-06.md` — authoritative summary of what is proven, what failed, and what is useful to YouxAI now
- `reports/browser_benchmark_summary.md` — real browser benchmark baseline vs TurboQuant results
- `reports/honest_retrospective.md` — correction of earlier optimistic assumptions
- `reports/turboquant_fix_findings.md` — latest KV-cache quantization findings for Qwen3
- `reports/launch_8k_batch_validation_2026-03-28.md` — claim-safe 8k validation evidence

Short version:

- standard MLC/WebLLM is the reliable shipping path
- 8k custom context is validated
- Qwen3 TurboQuant INT3/INT4 is not shippable
- real INT8 KV storage is promising for memory reduction, but not yet a latency win

---

## 🚀 Quick Start (Local Deployment)

No build step required for the core engine. Serve the application locally to prevent CORS blockages during WebAssembly instantiation:

```bash
npm run serve:root
```

Navigate to `http://localhost:8765/bench.html` to access the engineering console:
- **⚡ Bench:** Isolate and benchmark a single model's WebGPU performance.
- **📊 Compare:** Execute deterministic side-by-side prompt ingestion and measure rendering deltas.
- **🏆 Best Model:** Filter the registry by VRAM constraints and execute multi-model sweeps.

---

## 🛠️ The 8K Validation & Compilation Protocol

A critical focus of this repository is pushing the boundaries of browser VRAM. Standard WebLLM models are capped at 4k context limits. 

We established a reproducible protocol for compiling custom context windows. For publishable 8k claims on consumer hardware, utilize the official pipeline:

1. **Review the Compilation Guide:** [CUSTOM_CONTEXT_GUIDE.md](docs/CUSTOM_CONTEXT_GUIDE.md) provides step-by-step instructions for utilizing Python 3.12 and the Emscripten SDK to compile custom MLC configurations.
2. **Execute the Harness:** See [VALIDATION_PROTOCOL_8K.md](docs/VALIDATION_PROTOCOL_8K.md).
3. **Generate the Report:**
   ```bash
   npm run report:8k:validation -- --in /absolute/path/to/extracted-telemetry.json
   ```

## 🖥️ Modern Product UI Migration
The legacy infrastructure (`bench.html`) runs on pure JS. We are currently migrating the evaluation arena to a scalable React 19 + Tailwind architecture.

```bash
cd apps/web
npm install
cd ../..
npm run dev:web
```

---

## 📂 System Architecture & Repository Structure

The repository is modularized to separate the React product shell, the benchmarking extension, and the underlying inference shims.

```
├── bench.html / bench.js          # Standalone legacy WebGPU benchmark harness
├── apps/web/                      # React 19 + Tailwind product shell (Arena UI)
├── webllm-lab/                    # Runtime engine, WebLLM client, ABI shims
├── extension-lab/                 # Manifest V3 Chrome extension for isolated A/B testing
├── scripts/                       # CI/CD, build, and automated JS reporting scripts
├── docs/                          
│   ├── CUSTOM_CONTEXT_GUIDE.md    # WASM compilation logic for 8k/16k/32k limits
│   └── EXPERIMENTAL_TURBOQUANT.md # Research logs on KV cache quantization kernels
├── mlc-fork/                      # Experimental MLC patches mapping to CoreML/WebGPU
└── tests/                         # Vitest integration suites
```

---

## 🧪 Experimental R&D: TurboQuant KV Caching
This repository contains experimental research into implementing [TurboQuant](https://openreview.net/forum?id=tO3ASKZlok) (ICLR 2026) logic for KV cache quantization. While the kernels successfully compile and execute in our test harness, measurable latency speedups are currently bottlenecked by WebGPU shader dispatch overhead. Technical status and mitigation paths are logged in [docs/EXPERIMENTAL_TURBOQUANT.md](docs/EXPERIMENTAL_TURBOQUANT.md).

## ⚙️ Hardware & Environment Requirements
- **Browser:** Chrome 113+ or Edge 113+ (WebGPU flag enabled if required).
- **Hardware:** Integrated or discrete GPU supporting minimum FP16 shader ops.
- **Build Environment (Custom Contex):** Python 3.12+, Emscripten SDK.

## Acknowledgements
- [WebLLM](https://github.com/mlc-ai/web-llm) & [MLC-LLM](https://github.com/mlc-ai/mlc-llm) by MLC AI
- Infrastructure insights derived from **YouxAI** production deployments.

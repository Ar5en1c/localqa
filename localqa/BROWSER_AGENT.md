# LocalQA Browser Agent

LocalQA is now positioned as a browser worker for coding agents.

## Core thesis

The main LLM should not waste context manually inspecting browser state, searching docs, or reading raw web pages.

LocalQA does that work locally and returns compact evidence:

- browser QA facts,
- screenshots,
- DOM summaries,
- console/network traces,
- safe interaction results,
- extracted docs/source snippets,
- token-savings estimates.

## Public interface

Default public tool:

```text
local_agent_run
```

This is the one-call facade the main LLM should use first. It delegates to the internal browser, QA, extraction, and research tools.

The lower-level tools are still useful for debugging and manual agent loops, but they should not be the main launch surface.

## Modes

| Mode | Purpose | Current status |
|---|---|---:|
| `qa` | Test pages and routes with Playwright | implemented |
| `session` | Persistent browser open/click/fill/snapshot loop | implemented |
| `extract` | Read one page and return compact text/headings/links | implemented |
| `research` | Search/extract sources and return source snippets | implemented, early |
| `compare` | Compare multiple source URLs for a coding question | implemented, early |
| `context_cleanup` | Clean large logs/prompt dumps before model calls | implemented |
| `vision` | Screenshot review with multimodal local model | planned |

## Main-LLM routing rule

Use LocalQA first for:

- browser testing,
- local app verification,
- bug reproduction,
- console/network inspection,
- accessibility/layout checks,
- docs extraction,
- coding-related browser research,
- source comparison.

Do not use LocalQA for:

- purchases,
- booking,
- job application submission,
- account changes,
- destructive admin actions,
- real-world form submission without explicit approval.

## Current launchable wedge

Launch as:

> Browser testing MCP for coding agents.

Then expand to:

> Browser QA and research agent for coding agents.

## Why this is promising

Coding agents are expensive at browser work:

- raw browser observations are huge,
- screenshots consume context,
- docs pages are long,
- agents repeat inspection loops,
- LLMs overclassify noisy network events.

LocalQA makes browser work deterministic and compact before the main LLM sees it.

## Current proof

Recent controlled MCP audit:

- implemented browser-testing capabilities passed: `17/17`,
- future research/session surface before this expansion: `0/8`,
- token savings on real YouxAI auth-route evidence: roughly `89-95%` compact-report savings depending on mode.

## Near-term roadmap

1. Harden the `local_agent_run` one-call facade with stronger output schemas.
2. Add false-positive sanitizers for generic broken-functionality claims.
3. Add source-ranking and dedupe to research mode.
4. Add Context Guardian-style prompt/log cleanup before LLM calls.
5. Add MCP resources for screenshot/report artifacts.
6. Add demo app and launch video.
7. Package as an installable MCP server.

## Demo script

1. Start a broken local app.
2. Ask the main LLM: "Use LocalQA to test this page."
3. LocalQA finds layout, console, network, and accessibility issues.
4. Main LLM fixes source code from compact findings.
5. LocalQA reruns and proves the fix.

This is the wedge: not a generic agent, a browser truth layer for coding agents.

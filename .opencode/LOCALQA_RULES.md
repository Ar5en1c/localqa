# LocalQA Rules for OpenCode

Use LocalQA as the local evidence and memory layer. The frontier model remains responsible for planning, reasoning, and implementation.

Core rules:

- Before reasoning about raw logs, DOM dumps, browser console output, network traces, stack traces, screenshots, or large tool output, call `local_agent_run`.
- Prefer `filePath` / `filePaths` over pasted raw text when evidence is in local files.
- For complex work, prefer `controlMode: "directed"`: the main agent should specify exact `directedSteps`, budgets, and `outputContract`.
- For sensitive or reproducible work, use `controlMode: "strict"` so unknown local tools are rejected.
- Before repeating prior project investigation, use `controlMode: "memory"` and ask what was already tried, skipped, or proven.
- After meaningful work, use `controlMode: "record"` to write durable local memory with what changed, tests run, result, failures, skipped items, and next steps.
- For browser QA, call `local_agent_run` with `mode: "browser_qa"` or a directed `browser_qa` step instead of manually collecting raw DOM/context into the cloud conversation.
- When a result contains `vault://`, `artifact://`, or `localqa://context-index` handles, use `answer_from_handle` for scoped questions.
- Do not ask for raw vault artifact contents unless the user explicitly approves.
- Do not send raw evidence to an external model/server if LocalQA policy says `rawExternalSendAllowed: false`.
- Treat LocalQA confirmed issues as stronger than suspected/unproven signals.
- If LocalQA reports token savings, preserve those numbers in user-facing summaries.

Directed mode template:

```json
{
  "controlMode": "directed",
  "task": "State the investigation goal.",
  "directedSteps": [
    { "tool": "memory_query", "question": "What did we already try?" },
    { "tool": "context_cleanup", "filePath": "./path/to/evidence.txt", "task": "Extract likely files, commands, risks, and next reads.", "contextBudgetTokens": 1200 }
  ],
  "outputContract": {
    "maxTokens": 1600,
    "include": ["verified_findings", "evidence", "likely_files", "risks", "next_actions"],
    "exclude": ["raw_logs", "raw_dom", "full_file_tree"]
  }
}
```

Privacy boundary:

- These rules do not protect text the user already pasted into the prompt.
- For private logs/files, ask the user for a local path and use LocalQA.
- LocalQA is a context/evidence control layer, not a network-level prompt interceptor.

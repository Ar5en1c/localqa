# LocalQA Security and Privacy Boundary

LocalQA is local-first, not magic privacy.

## What stays local when used correctly

When the user gives LocalQA a path, URL, or local task, LocalQA can collect and compact evidence locally:

- logs from local files
- browser evidence from local Playwright runs
- DOM/accessibility/network summaries
- repo evidence selected by local tools
- project memory records
- vault artifacts and handles

The frontier model can receive a compact report instead of the raw evidence.

## What does not stay local

If a user pastes raw secrets, logs, DOM dumps, or source code directly into cloud chat, that text has already gone to the cloud before MCP can help.

Correct usage:

```text
Use LocalQA to analyze ./logs/dev.log and return only verified auth/session errors.
```

Incorrect usage:

```text
Here are 50,000 characters of logs pasted directly into cloud chat...
```

## Redaction and handoff

LocalQA includes handoff and redaction paths for compacting sensitive evidence before external send. Launch checks include synthetic redaction and no-leak gates.

Security gates in the launch check include:

- strict one-tool surface rejection
- handoff no-leak smoke
- OpenCode runner redaction smoke

## Remaining caveats

- LocalQA is alpha software.
- It should not be treated as a formal DLP product.
- It does not intercept the first prompt in cloud agent UIs.
- It does not guarantee that every host agent will always call MCP unless the host provides enforceable tool/rule hooks.
- The OpenCode plugin gives stronger host integration than MCP alone, but even that is not a network-level prompt firewall.

## Recommended user behavior

- Keep cloud prompts short.
- Give LocalQA file paths, URLs, and task instructions.
- Do not paste raw private logs into cloud chat.
- Use `LOCALQA_PUBLIC_SURFACE=agent-strict` for public/default MCP usage.
- Use OpenCode plugin mode when you want stronger local workflow integration.

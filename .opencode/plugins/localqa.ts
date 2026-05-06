import type { Plugin } from "@opencode-ai/plugin"

const RAW_EVIDENCE_MIN_CHARS = Number.parseInt(process.env.LOCALQA_OPENCODE_COMPACT_MIN_CHARS || "4000", 10)
const PLUGIN_REPO_ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "")

function resolveWorktree(worktree: unknown) {
  const candidate = String(worktree || process.env.LOCALQA_WORKTREE || "").trim()
  if (candidate && candidate !== "/") return candidate.replace(/\/$/, "")
  return PLUGIN_REPO_ROOT
}

function looksLikeRawEvidence(value: string) {
  if (value.length >= RAW_EVIDENCE_MIN_CHARS) return true
  return /(?:TypeError|ReferenceError|SyntaxError|Traceback|Stack trace|npm ERR|HTTP [45]\d\d|<html|<body|aria-|locator|selector|console\.error)/i.test(value)
}

function compactPayload(value: string) {
  if (!looksLikeRawEvidence(value)) return null
  return {
    task: "Compact this OpenCode tool output before it remains in cloud context. Preserve root causes, errors, selectors, URLs, stack frames, and actionable evidence.",
    text: value,
    contextBudgetTokens: Number.parseInt(process.env.LOCALQA_OPENCODE_COMPACT_BUDGET_TOKENS || "1600", 10),
  }
}

async function runJsonScript(worktree: string, script: string, args: unknown) {
  const tmpDir = `${worktree}/.opencode/tmp`
  await Bun.$`mkdir -p ${tmpDir}`.text().catch(() => "")
  const tmpPath = `${tmpDir}/localqa-plugin-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
  await Bun.write(tmpPath, JSON.stringify(args))
  try {
    return (await Bun.$`node ${script} --input-file ${tmpPath}`.text()).trim()
  } finally {
    await Bun.write(tmpPath, "").catch(() => undefined)
    await Bun.$`rm -f ${tmpPath}`.text().catch(() => "")
  }
}

export const LocalQAPlugin: Plugin = async ({ $, worktree }) => {
  const repoRoot = resolveWorktree(worktree)
  return {
    "tool.execute.before": async (input, output) => {
      if (input.tool === "read" && /(^|\/)\.env(\.|$)/.test(String(output.args?.filePath || output.args?.path || ""))) {
        throw new Error("LocalQA blocked reading .env directly. If needed, ask the user and route through local_agent_run with handoff_gate.")
      }
    },

    "tool.execute.after": async (input, output) => {
      if (!["bash", "read", "webfetch"].includes(String(input.tool))) return
      const raw = String(output.output || "")
      const payload = compactPayload(raw)
      if (!payload) return
      const script = `${repoRoot}/scripts/localqa-opencode-runner.mjs`
      const compacted = await runJsonScript(repoRoot, script, payload).catch(() => "")
      if (!compacted.trim()) return
      let handle = ""
      try {
        const parsed = JSON.parse(compacted)
        handle = String(parsed?.handle || "")
      } catch {
        handle = ""
      }
      output.output = [
        "LocalQA compacted a large/noisy tool result before it stayed in context.",
        "Raw output was not preserved in this message. Use LocalQA vault handles or rerun with explicit approval if raw evidence is required.",
        "For follow-up, call local_agent_run with controlMode=\"memory\" for prior work, or answer_from_handle for scoped vault questions.",
        "",
        compacted.trim(),
      ].join("\n")
      if (output.metadata && typeof output.metadata === "object") {
        output.metadata = {
          ...output.metadata,
          output: `LocalQA compacted raw tool output.${handle ? ` Handle: ${handle}.` : ""}`,
          localqaCompacted: true,
          localqaHandle: handle || undefined,
        }
      }
    },

    "experimental.session.compacting": async (_input, output) => {
      const manifestScript = `${repoRoot}/scripts/localqa-vault-query.mjs`
      const context = [
        "## LocalQA Evidence Kernel",
        "Raw logs, DOM dumps, browser evidence, and large tool outputs should be represented as LocalQA summaries or vault handles.",
        "If a vault:// or artifact:// handle appears, use answer_from_handle to ask scoped questions instead of requesting raw data.",
        "Do not rehydrate raw evidence into cloud context unless the user explicitly approves.",
      ].join("\n")
      output.context.push(context)
      void manifestScript
    },

    "shell.env": async (_input, output) => {
      output.env.LOCALQA_DEFAULT_LLM = output.env.LOCALQA_DEFAULT_LLM || process.env.LOCALQA_DEFAULT_LLM || "bonsai"
      output.env.LOCALQA_BONSAI_AUTOSTART = output.env.LOCALQA_BONSAI_AUTOSTART || process.env.LOCALQA_BONSAI_AUTOSTART || "1"
      output.env.LOCALQA_LLM_PROVIDER = output.env.LOCALQA_LLM_PROVIDER || process.env.LOCALQA_LLM_PROVIDER || "openai-compatible"
      output.env.LOCALQA_LLM_ENDPOINT = output.env.LOCALQA_LLM_ENDPOINT || process.env.LOCALQA_LLM_ENDPOINT || "http://127.0.0.1:18081/v1/chat/completions"
      output.env.LOCALQA_LLM_MODEL = output.env.LOCALQA_LLM_MODEL || process.env.LOCALQA_LLM_MODEL || "Bonsai-8B.gguf"
    },
  }
}

import { tool } from "@opencode-ai/plugin"

const TOOL_REPO_ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "")

function resolveWorktree(context: unknown) {
  const candidate = String((context as { worktree?: string; cwd?: string; directory?: string })?.worktree ||
    (context as { cwd?: string })?.cwd ||
    (context as { directory?: string })?.directory ||
    process.env.LOCALQA_WORKTREE ||
    "").trim()
  if (candidate && candidate !== "/") return candidate.replace(/\/$/, "")
  return TOOL_REPO_ROOT
}

function absolutePath(worktree: string, value: unknown) {
  const file = String(value || "").trim()
  if (!file || file.startsWith("/") || /^[A-Za-z]:[\\/]/.test(file)) return file
  return `${worktree}/${file}`
}

function normalizeArgs(worktree: string, args: Record<string, unknown>) {
  const next: Record<string, unknown> = { ...args }
  if (next.artifactPath) next.artifactPath = absolutePath(worktree, next.artifactPath)
  return next
}

async function runJsonScript(worktree: string, script: string, args: unknown) {
  const tmpDir = `${worktree}/.opencode/tmp`
  await Bun.$`mkdir -p ${tmpDir}`.text().catch(() => "")
  const tmpPath = `${tmpDir}/answer_from_handle-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
  await Bun.write(tmpPath, JSON.stringify(args))
  try {
    return (await Bun.$`node ${script} --input-file ${tmpPath}`.text()).trim()
  } finally {
    await Bun.write(tmpPath, "").catch(() => undefined)
    await Bun.$`rm -f ${tmpPath}`.text().catch(() => "")
  }
}

export default tool({
  description: [
    "Query a LocalQA local evidence handle without exposing the raw artifact.",
    "Use this when the conversation contains vault://, artifact://, or localqa://context-index handles.",
    "Ask a specific question and this tool returns a compact local answer."
  ].join(" "),
  args: {
    handle: tool.schema.string().describe("A LocalQA handle, for example vault://abc123 or artifact://abc123."),
    question: tool.schema.string().describe("Specific question to answer from the local artifact."),
    contextBudgetTokens: tool.schema.number().optional().describe("Maximum compact evidence budget."),
    maxLines: tool.schema.number().optional(),
  },
  async execute(args, context) {
    const worktree = resolveWorktree(context)
    const script = `${worktree}/scripts/localqa-vault-query.mjs`
    return runJsonScript(worktree, script, normalizeArgs(worktree, args))
  },
})

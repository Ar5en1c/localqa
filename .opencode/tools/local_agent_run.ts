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
  if (next.filePath) next.filePath = absolutePath(worktree, next.filePath)
  if (Array.isArray(next.filePaths)) {
    next.filePaths = next.filePaths.map((entry) => {
      if (typeof entry === "string") return absolutePath(worktree, entry)
      if (entry && typeof entry === "object" && "path" in entry) {
        return { ...entry, path: absolutePath(worktree, (entry as { path?: unknown }).path) }
      }
      return entry
    })
  }
  if (!next.outputDir) next.outputDir = `${worktree}/.opencode/vault-runs`
  else next.outputDir = absolutePath(worktree, next.outputDir)
  if (next.memoryDir) next.memoryDir = absolutePath(worktree, next.memoryDir)
  else next.memoryDir = `${worktree}/.localqa/memory`
  return next
}

async function runJsonScript(worktree: string, script: string, args: unknown) {
  const tmpDir = `${worktree}/.opencode/tmp`
  await Bun.$`mkdir -p ${tmpDir}`.text().catch(() => "")
  const tmpPath = `${tmpDir}/local_agent_run-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
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
    "LocalQA evidence agent. Call this FIRST before acting on raw logs, DOM dumps, browser evidence, screenshots, network traces, stack traces, or large context.",
    "It runs locally and returns compact verified evidence, token savings, policy flags, and optional vault handles.",
    "Supports directed execution: the frontier model can provide exact directedSteps and LocalQA will execute them locally, compact outputs, and write project memory.",
    "Supports browser QA, site QA, research, page extraction, log analysis, prompt cleanup, context cleanup, handoff gating, project memory query/record, and local file paths."
  ].join(" "),
  args: {
    controlMode: tool.schema.enum([
      "auto",
      "directed",
      "strict",
      "memory",
      "record",
    ]).optional().describe("auto lets LocalQA route. directed/strict executes caller-provided directedSteps. memory queries local project memory. record writes a work-memory entry."),
    mode: tool.schema.enum([
      "auto",
      "browser_qa",
      "site_qa",
      "research",
      "extract_page",
      "log_analysis",
      "prompt_cleanup",
      "context_cleanup",
      "handoff_gate",
      "memory",
      "project_memory",
      "record_work",
    ]).optional(),
    task: tool.schema.string().describe("What to test, verify, clean, research, or prepare."),
    directedSteps: tool.schema.array(tool.schema.object({
      tool: tool.schema.enum([
        "browser_qa",
        "site_qa",
        "research",
        "extract_page",
        "log_analysis",
        "prompt_cleanup",
        "context_cleanup",
        "handoff_gate",
        "memory_query",
        "project_memory",
        "memory_record",
        "record",
      ]),
      task: tool.schema.string().optional(),
      url: tool.schema.string().optional(),
      urls: tool.schema.array(tool.schema.string()).optional(),
      query: tool.schema.string().optional(),
      text: tool.schema.string().optional(),
      filePath: tool.schema.string().optional(),
      filePaths: tool.schema.array(tool.schema.union([
        tool.schema.string(),
        tool.schema.object({
          path: tool.schema.string(),
          label: tool.schema.string().optional(),
        }),
      ])).optional(),
      contextBudgetTokens: tool.schema.number().optional(),
      maxLinks: tool.schema.number().optional(),
      waitMs: tool.schema.number().optional(),
      expectedText: tool.schema.array(tool.schema.string()).optional(),
    })).optional().describe("Exact local steps planned by the frontier model. Use with controlMode=directed or strict."),
    outputContract: tool.schema.object({
      maxTokens: tool.schema.number().optional(),
      include: tool.schema.array(tool.schema.string()).optional(),
      exclude: tool.schema.array(tool.schema.string()).optional(),
    }).optional().describe("Compact output contract for LocalQA before returning evidence to the main model."),
    url: tool.schema.string().optional().describe("URL for browser QA, page extraction, site QA, or research."),
    urls: tool.schema.array(tool.schema.string()).optional().describe("Multiple URLs for research or site QA."),
    text: tool.schema.string().optional().describe("Raw evidence only if already inside OpenCode. Prefer filePath for local files."),
    filePath: tool.schema.string().optional().describe("Local file path for logs, dumps, traces, or raw evidence. Prefer this over pasted text."),
    filePaths: tool.schema.array(tool.schema.union([
      tool.schema.string(),
      tool.schema.object({
        path: tool.schema.string(),
        label: tool.schema.string().optional(),
      }),
    ])).optional(),
    contextBudgetTokens: tool.schema.number().optional(),
    memoryDir: tool.schema.string().optional().describe("Optional project memory directory. Defaults to .localqa/memory in the worktree."),
    recordMemory: tool.schema.boolean().optional().describe("Whether LocalQA should write a permanent local memory summary. Defaults to true."),
    question: tool.schema.string().optional().describe("Question for controlMode=memory or memory_query steps."),
    summary: tool.schema.string().optional().describe("Summary for controlMode=record."),
    whatChanged: tool.schema.string().optional().describe("Work summary for controlMode=record."),
    testsRun: tool.schema.string().optional().describe("Validation summary for controlMode=record."),
    workResult: tool.schema.string().optional().describe("Result/outcome for controlMode=record."),
    worked: tool.schema.array(tool.schema.string()).optional(),
    failed: tool.schema.array(tool.schema.string()).optional(),
    skipped: tool.schema.array(tool.schema.string()).optional(),
    next: tool.schema.array(tool.schema.string()).optional(),
    tags: tool.schema.array(tool.schema.string()).optional(),
    destinationKind: tool.schema.enum(["main_llm", "external_server", "local_server", "unknown"]).optional(),
    externalSendAttempted: tool.schema.boolean().optional(),
    sendPayloadKind: tool.schema.enum(["raw", "compact", "unknown"]).optional(),
    waitMs: tool.schema.number().optional(),
    maxLinks: tool.schema.number().optional(),
    expectedText: tool.schema.array(tool.schema.string()).optional(),
  },
  async execute(args, context) {
    const worktree = resolveWorktree(context)
    const script = `${worktree}/scripts/localqa-opencode-runner.mjs`
    return runJsonScript(worktree, script, normalizeArgs(worktree, args))
  },
})

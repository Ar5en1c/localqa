#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const ROOT = process.cwd();
const RUN_DATE = process.env.LOCALQA_REPORT_DATE || new Date().toISOString().slice(0, 10);
const OUT_DIR = path.resolve(process.env.LOCALQA_OPENCODE_OSS_BENCH_OUT_DIR || `reports/localqa/opencode_oss_codebases_${RUN_DATE}`);
const WORK_DIR = path.resolve(process.env.LOCALQA_OPENCODE_OSS_WORK_DIR || 'tmp/localqa-opencode-oss-codebases');
const RUNNER = path.resolve('scripts/localqa-opencode-runner.mjs');

const CASES = [
  {
    name: 'expressjs_express',
    project: 'expressjs/express',
    archiveUrl: 'https://codeload.github.com/expressjs/express/tar.gz/refs/heads/master',
    expectedSignals: ['express', 'router', 'middleware', 'mocha'],
    task: 'Analyze this Express OSS codebase evidence. Identify project purpose, likely test command, major source/test areas, and any high-signal maintenance risks. Do not quote raw files; compact to actionable codebase evidence.',
  },
  {
    name: 'fastify_fastify',
    project: 'fastify/fastify',
    archiveUrl: 'https://codeload.github.com/fastify/fastify/tar.gz/refs/heads/main',
    expectedSignals: ['fastify', 'plugin', 'schema', 'test'],
    task: 'Analyze this Fastify OSS codebase evidence. Identify project purpose, likely test command, major source/test areas, and any high-signal maintenance risks. Do not quote raw files; compact to actionable codebase evidence.',
  },
  {
    name: 'colinhacks_zod',
    project: 'colinhacks/zod',
    archiveUrl: 'https://codeload.github.com/colinhacks/zod/tar.gz/refs/heads/main',
    expectedSignals: ['zod', 'typescript', 'schema', 'test'],
    task: 'Analyze this Zod OSS codebase evidence. Identify project purpose, likely test command, major source/test areas, and any high-signal maintenance risks. Do not quote raw files; compact to actionable codebase evidence.',
  },
];

const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.next', '.turbo', '.cache', 'vendor', 'fixtures', 'fixture', 'snapshots']);
const TEXT_EXTENSIONS = new Set(['.js', '.cjs', '.mjs', '.ts', '.tsx', '.jsx', '.json', '.md', '.yml', '.yaml', '.toml', '.lock']);

function approxTokens(value) {
  return Math.ceil(String(value || '').length / 4);
}

function pct(saved, raw) {
  return raw > 0 ? +((saved / raw) * 100).toFixed(2) : 0;
}

function sanitizeMd(value) {
  return String(value ?? '').replaceAll('|', '\\|').replace(/\s+/g, ' ').trim();
}

async function pathExists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function ensureCleanDir(dir) {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
}

async function downloadArchive(testCase, caseWorkDir) {
  await fs.mkdir(caseWorkDir, { recursive: true });
  const archivePath = path.join(caseWorkDir, 'source.tar.gz');
  if (!(await pathExists(archivePath))) {
    const res = await fetch(testCase.archiveUrl, { signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new Error(`archive download failed ${res.status} ${testCase.archiveUrl}`);
    const data = Buffer.from(await res.arrayBuffer());
    await fs.writeFile(archivePath, data);
  }
  const extractDir = path.join(caseWorkDir, 'src');
  await ensureCleanDir(extractDir);
  await execFileAsync('tar', ['-xzf', archivePath, '-C', extractDir, '--strip-components=1'], { maxBuffer: 1024 * 1024 * 8 });
  return { archivePath, repoDir: extractDir };
}

async function walkFiles(dir, maxFiles = 1200) {
  const out = [];
  async function walk(current) {
    if (out.length >= maxFiles) return;
    const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (out.length >= maxFiles) return;
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(current, entry.name);
      const rel = path.relative(dir, full);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        out.push(rel);
      }
    }
  }
  await walk(dir);
  return out;
}

function scoreFile(file) {
  const lower = file.toLowerCase();
  let score = 0;
  if (/(^|\/)package\.json$/.test(lower)) score += 100;
  if (/(^|\/)readme(\.[a-z]+)?$/.test(lower)) score += 95;
  if (/(^|\/)(contributing|architecture|testing|test|docs?)\.(md|mdx)$/.test(lower)) score += 70;
  if (/(^|\/)(src|lib|packages)\//.test(lower)) score += 45;
  if (/(^|\/)(test|tests|__tests__)\//.test(lower)) score += 40;
  if (/\.(ts|tsx|js|mjs|cjs)$/.test(lower)) score += 15;
  if (/\.(json|ya?ml|toml)$/.test(lower)) score += 8;
  if (/fixture|snapshot|dist|bundle|min\.js|lock$/.test(lower)) score -= 80;
  return score;
}

async function readTextFile(repoDir, rel, maxChars = 6000) {
  const full = path.join(repoDir, rel);
  const ext = path.extname(rel).toLowerCase();
  if (!TEXT_EXTENSIONS.has(ext) && !/readme|license|contributing/i.test(path.basename(rel))) return null;
  const stat = await fs.stat(full).catch(() => null);
  if (!stat || stat.size > 900_000) return null;
  const text = await fs.readFile(full, 'utf8').catch(() => null);
  if (text == null || /\u0000/.test(text)) return null;
  return String(text).slice(0, maxChars);
}

async function buildEvidenceBundle(testCase, repoDir, caseOutDir) {
  const files = await walkFiles(repoDir);
  const tree = files.slice(0, 700).join('\n');
  const selected = files
    .map((file) => ({ file, score: scoreFile(file) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file))
    .slice(0, 28);

  const excerpts = [];
  for (const item of selected) {
    const text = await readTextFile(repoDir, item.file, 6500);
    if (!text) continue;
    excerpts.push(`FILE: ${item.file}\n${text}`);
  }

  const packageJsonText = await readTextFile(repoDir, 'package.json', 20000);
  let scripts = {};
  let dependencies = [];
  if (packageJsonText) {
    try {
      const pkg = JSON.parse(packageJsonText);
      scripts = pkg.scripts || {};
      dependencies = Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }).slice(0, 80);
    } catch {
      // keep raw package excerpt only
    }
  }

  const rgLikeLines = [];
  for (const rel of files.slice(0, 1200)) {
    if (!/\.(ts|tsx|js|mjs|cjs|md|json)$/.test(rel)) continue;
    const text = await readTextFile(repoDir, rel, 12000);
    if (!text) continue;
    const lines = text.split('\n');
    lines.forEach((line, idx) => {
      if (/\b(TODO|FIXME|test\(|describe\(|it\(|vitest|jest|mocha|tap|ava|playwright|eslint|tsc|build|coverage|deprecated|warning|error)\b/i.test(line)) {
        rgLikeLines.push(`${rel}:${idx + 1}: ${line.trim().slice(0, 260)}`);
      }
    });
    if (rgLikeLines.length > 500) break;
  }

  const evidence = [
    `OSS_CODEBASE_BENCHMARK_PROJECT: ${testCase.project}`,
    `ARCHIVE_URL: ${testCase.archiveUrl}`,
    `TASK: ${testCase.task}`,
    '',
    'SIMULATED_NON_MCP_AGENT_RAW_CONTEXT:',
    '- tool: find/list repo files',
    '- tool: cat package.json',
    '- tool: cat README/docs',
    '- tool: grep/rg for tests, TODOs, errors, build scripts',
    '- tool: read selected source/test files',
    '',
    'PACKAGE_SCRIPTS_JSON:',
    JSON.stringify(scripts, null, 2),
    '',
    'TOP_DEPENDENCIES:',
    dependencies.join(', '),
    '',
    'FILE_TREE_HEAD:',
    tree,
    '',
    'RG_LIKE_SIGNAL_LINES:',
    rgLikeLines.slice(0, 450).join('\n'),
    '',
    'SELECTED_FILE_EXCERPTS:',
    excerpts.join('\n\n---\n\n'),
  ].join('\n');

  const evidencePath = path.join(caseOutDir, 'raw-codebase-evidence.txt');
  await fs.writeFile(evidencePath, evidence);
  return {
    evidence,
    evidencePath,
    fileCount: files.length,
    selectedFiles: selected.map((item) => item.file),
    scripts,
    dependencies,
  };
}

function runOpenCodeBridge(args) {
  const startedAt = performance.now();
  const stdout = execFileSync('node', [RUNNER], {
    input: JSON.stringify(args),
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 12,
  });
  return {
    durationMs: +(performance.now() - startedAt).toFixed(2),
    result: JSON.parse(stdout),
  };
}

function signalCoverage(text, expectedSignals) {
  const lower = String(text || '').toLowerCase();
  const matched = expectedSignals.filter((signal) => lower.includes(signal.toLowerCase()));
  return {
    matched,
    missing: expectedSignals.filter((signal) => !matched.includes(signal)),
    score: expectedSignals.length ? +(matched.length / expectedSignals.length).toFixed(2) : 1,
  };
}

function caseMarkdown(summary) {
  return `## ${summary.project}\n\n- Source: ${summary.archiveUrl}\n- Raw evidence file: \`${path.relative(ROOT, summary.evidencePath)}\`\n- Files scanned: ${summary.fileCount}\n- Selected mode: ${summary.selectedMode}\n- Bridge wall time: ${summary.bridgeDurationMs} ms\n- Raw approx tokens: ${summary.rawApproxTokens}\n- Compact approx tokens: ${summary.compactApproxTokens}\n- Saved approx tokens: ${summary.savedApproxTokens}\n- Reduction: ${summary.reductionRatio}%\n- Expected signal coverage: ${summary.signalCoverage.matched.length}/${summary.expectedSignals.length} (${summary.signalCoverage.score})\n- Matched signals: ${summary.signalCoverage.matched.join(', ') || 'none'}\n- Missing signals: ${summary.signalCoverage.missing.join(', ') || 'none'}\n\nCompact preview:\n\n\`\`\`text\n${String(summary.compactPreview || '').slice(0, 1800)}\n\`\`\`\n`;
}

function reportMarkdown(report) {
  const rows = report.cases.map((item) => `| ${item.project} | ${item.fileCount} | ${item.rawApproxTokens} | ${item.compactApproxTokens} | ${item.savedApproxTokens} | ${item.reductionRatio}% | ${item.bridgeDurationMs} | ${item.signalCoverage.matched.length}/${item.expectedSignals.length} |`).join('\n');
  const reductions = report.cases.map((item) => item.reductionRatio).filter((value) => Number.isFinite(value));
  const avg = reductions.length ? +(reductions.reduce((a, b) => a + b, 0) / reductions.length).toFixed(2) : 0;
  const min = reductions.length ? Math.min(...reductions) : 0;
  const max = reductions.length ? Math.max(...reductions) : 0;
  const totalRaw = report.cases.reduce((sum, item) => sum + item.rawApproxTokens, 0);
  const totalCompact = report.cases.reduce((sum, item) => sum + item.compactApproxTokens, 0);
  const totalSaved = Math.max(0, totalRaw - totalCompact);
  const totalReduction = pct(totalSaved, totalRaw);
  return `# LocalQA OpenCode Plugin OSS Codebase Benchmark\n\nDate: ${report.generatedAt}\n\n## What this validates\n\nThis benchmark uses real open-source codebase archives and feeds codebase evidence through the same Node bridge used by the OpenCode \`local_agent_run\` custom tool. It measures the practical savings when a coding agent would otherwise stuff raw repo evidence into the cloud context.\n\nThis is not a model-quality benchmark. It is a codebase-evidence compaction and safety benchmark.\n\n## Summary\n\n- Repos tested: ${report.cases.length}\n- Total raw approx tokens: ${totalRaw}\n- Total compact approx tokens: ${totalCompact}\n- Total saved approx tokens: ${totalSaved}\n- Total reduction: ${totalReduction}%\n- Per-repo reduction range: ${min}% to ${max}%\n- Average per-repo reduction: ${avg}%\n\n| Project | Files scanned | Raw toks | Compact toks | Saved toks | Reduction | Bridge ms | Signals |\n|---|---:|---:|---:|---:|---:|---:|---:|\n${rows}\n\n## Method\n\nFor each repo, the script downloads a public source archive, extracts it locally, builds a raw evidence bundle from file tree, package scripts, dependency names, grep-like code/test signals, README/docs, and selected source/test excerpts, then calls:\n\n\`\`\`bash\nnode scripts/localqa-opencode-runner.mjs\n\`\`\`\n\nwith \`mode=context_cleanup\`. That is the same bridge called by the OpenCode custom tool.\n\nThe raw baseline approximates the context a normal coding agent would accumulate by using file listing, package reads, docs reads, grep, and source/test file reads directly.\n\n## Case details\n\n${report.cases.map(caseMarkdown).join('\n')}\n\n## Defensible claims\n\nSafe to claim from this run:\n\n- LocalQA's OpenCode bridge compressed real OSS codebase evidence by ${min}% to ${max}% in this ${report.cases.length}-repo run.\n- Total measured reduction was ${totalReduction}%: ${totalRaw} raw approx tokens to ${totalCompact} compact approx tokens.\n- The benchmark used public source archives, not synthetic repo text.\n\nDo not claim:\n\n- This proves code understanding quality equals a frontier model.\n- This prevents secrets pasted into the initial user prompt.\n- These exact ratios apply to every repo or every task.\n`;
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.mkdir(WORK_DIR, { recursive: true });
  const summaries = [];

  for (const testCase of CASES) {
    const caseOutDir = path.join(OUT_DIR, testCase.name);
    const caseWorkDir = path.join(WORK_DIR, testCase.name);
    await fs.mkdir(caseOutDir, { recursive: true });
    const { repoDir } = await downloadArchive(testCase, caseWorkDir);
    const evidence = await buildEvidenceBundle(testCase, repoDir, caseOutDir);
    const rawApproxTokens = approxTokens(evidence.evidence);
    const bridge = runOpenCodeBridge({
      mode: 'context_cleanup',
      task: testCase.task,
      text: evidence.evidence,
      contextBudgetTokens: 1600,
      outputDir: path.join(caseOutDir, 'vault-runs'),
    });
    const result = bridge.result;
    const compact = result.compactText || result.compactPayload || JSON.stringify(result, null, 2);
    const compactApproxTokens = result.tokenSavings?.compactReportApproxTokens ?? approxTokens(compact);
    const savedApproxTokens = result.tokenSavings?.savedApproxTokens ?? Math.max(0, rawApproxTokens - compactApproxTokens);
    const reductionRatio = result.tokenSavings?.reductionRatio ?? pct(savedApproxTokens, rawApproxTokens);
    const coverage = signalCoverage(compact, testCase.expectedSignals);
    const summary = {
      name: testCase.name,
      project: testCase.project,
      archiveUrl: testCase.archiveUrl,
      expectedSignals: testCase.expectedSignals,
      evidencePath: evidence.evidencePath,
      fileCount: evidence.fileCount,
      selectedFiles: evidence.selectedFiles,
      selectedMode: result.selectedMode,
      bridgeDurationMs: bridge.durationMs,
      rawApproxTokens,
      compactApproxTokens,
      savedApproxTokens,
      reductionRatio,
      signalCoverage: coverage,
      compactPreview: compact,
      result,
    };
    summaries.push(summary);
    await fs.writeFile(path.join(caseOutDir, 'summary.json'), JSON.stringify(summary, null, 2));
  }

  const report = {
    generatedAt: new Date().toISOString(),
    outDir: OUT_DIR,
    workDir: WORK_DIR,
    cases: summaries,
  };
  await fs.writeFile(path.join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2));
  await fs.writeFile(path.join(OUT_DIR, 'OPENCODE_OSS_CODEBASE_BENCHMARK.md'), reportMarkdown(report));
  console.log(JSON.stringify({
    ok: true,
    outDir: OUT_DIR,
    cases: summaries.map((item) => ({
      project: item.project,
      rawApproxTokens: item.rawApproxTokens,
      compactApproxTokens: item.compactApproxTokens,
      savedApproxTokens: item.savedApproxTokens,
      reductionRatio: item.reductionRatio,
      bridgeDurationMs: item.bridgeDurationMs,
      signalCoverage: item.signalCoverage,
    })),
  }, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err?.message || String(err), stack: String(err?.stack || '').split('\n').slice(0, 8).join('\n') }, null, 2));
  process.exitCode = 1;
});

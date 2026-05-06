#!/usr/bin/env node
import { mkdir, rm, cp, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const out = path.join(root, 'dist', 'localqa-public-alpha-2026-05-06');

const include = [
  'README.md',
  'LICENSE',
  'package.json',
  'opencode.json',
  'LOCALQA_PUBLIC_ALPHA_README.md',
  'LOCALQA_LAUNCH_PACKET_2026-05-06.md',
  'LOCALQA_PUBLIC_RELEASE_MANIFEST.md',
  'localqa',
  'docs/LOCALQA_INSTALL_AND_USAGE.md',
  'docs/LOCALQA_BENCHMARKS_AND_CLAIMS.md',
  'docs/LOCALQA_SECURITY_AND_PRIVACY.md',
  'docs/LOCALQA_LAUNCH_TODAY.md',
  'docs/LOCALQA_OPENCODE_USAGE.md',
  '.opencode/plugins',
  '.opencode/tools',
  '.opencode/LOCALQA_RULES.md',
  'scripts/localqa_launch_check.mjs',
  'scripts/localqa-opencode-runner.mjs',
  'scripts/localqa-vault-query.mjs',
  'scripts/smoke_localqa_opencode_redaction.mjs',
  'scripts/smoke_localqa_opencode_bridge.mjs',
  'scripts/check_docs_absolute_paths.mjs',
  'scripts/bench_localqa_agent_layer.mjs',
  'scripts/bench_localqa_agentic_workflows.mjs',
  'scripts/bench_localqa_ab_agent_workflows.mjs',
  'scripts/bench_localqa_long_horizon_300k.mjs',
  'scripts/bench_localqa_complex_code_tasks.mjs',
  'scripts/bench_opencode_provider_telemetry_ab.mjs',
  'tests',
  'reports/localqa/launch_assets_2026-05-06/terminal_demo.sh',
  'reports/localqa/launch_assets_2026-05-06/terminal_demo_transcript.txt',
  'reports/localqa/launch_assets_2026-05-06/x_post.txt',
  'reports/localqa/launch_assets_2026-05-06/linkedin_post.txt',
  'reports/localqa/launch_assets_2026-05-06/hn_reddit_post.txt',
  'reports/localqa/launch_assets_2026-05-06/LAUNCH_STATUS.md',
  'reports/localqa/launch_assets_2026-05-06/LAUNCH_FREEZE_2PM_PT.md',
  'reports/localqa/provider_telemetry_2026-05-05',
  'reports/localqa/ab_agent_workflows_2026-05-05',
  'reports/localqa/long_horizon_300k_2026-05-05',
  'reports/localqa/agentic_workflows_2026-05-05',
  'reports/localqa/agent_layer_real_env_2026-05-05',
  'reports/localqa/complex_code_tasks_2026-05-05',
  'reports/localqa/launch_check_2026-05-05',
];

const denySuffixes = ['.mov', '.har', '.trace', '.zip'];
const denyParts = [
  `${path.sep}.opencode${path.sep}vault-runs${path.sep}`,
  `${path.sep}.opencode${path.sep}tmp${path.sep}`,
  `${path.sep}reports${path.sep}localqa${path.sep}context-index${path.sep}`,
  `${path.sep}jobtracker-mlc-lab-worktree${path.sep}`,
  `${path.sep}node_modules${path.sep}`,
];

function allowed(p) {
  const normalized = path.resolve(p);
  if (denySuffixes.some((suffix) => normalized.endsWith(suffix))) return false;
  if (denyParts.some((part) => normalized.includes(part))) return false;
  return true;
}

async function copySafe(srcRel) {
  const src = path.join(root, srcRel);
  if (!existsSync(src)) return { srcRel, copied: false, reason: 'missing' };
  if (!allowed(src)) return { srcRel, copied: false, reason: 'denied' };
  const dest = path.join(out, srcRel);
  await mkdir(path.dirname(dest), { recursive: true });
  await cp(src, dest, {
    recursive: true,
    force: true,
    filter: (item) => allowed(item),
  });
  return { srcRel, copied: true };
}

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
const results = [];
for (const item of include) results.push(await copySafe(item));

await writeFile(path.join(out, 'RELEASE_NOTES.md'), `# LocalQA v0.1 Alpha Release Bundle\n\nGenerated: ${new Date().toISOString()}\n\nThis bundle excludes local vault artifacts, raw traces, local model files, node_modules, and screen recordings.\n\nRun after unpacking:\n\n\`\`\`bash\nnpm install\nnpm run localqa:launch-check\n\`\`\`\n\n`, 'utf8');
await writeFile(path.join(out, 'release-manifest.json'), JSON.stringify({ out, results }, null, 2), 'utf8');
console.log(JSON.stringify({ ok: true, out, copied: results.filter((r) => r.copied).length, skipped: results.filter((r) => !r.copied) }, null, 2));

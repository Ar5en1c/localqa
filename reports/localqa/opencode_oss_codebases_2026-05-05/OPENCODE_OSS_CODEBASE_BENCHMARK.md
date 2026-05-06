# LocalQA OpenCode Plugin OSS Codebase Benchmark

Date: 2026-05-05T04:15:51.905Z

## What this validates

This benchmark uses real open-source codebase archives and feeds codebase evidence through the same Node bridge used by the OpenCode `local_agent_run` custom tool. It measures the practical savings when a coding agent would otherwise stuff raw repo evidence into the cloud context.

This is not a model-quality benchmark. It is a codebase-evidence compaction and safety benchmark.

## Summary

- Repos tested: 3
- Total raw approx tokens: 100924
- Total compact approx tokens: 4966
- Total saved approx tokens: 95958
- Total reduction: 95.08%
- Per-repo reduction range: 93.05% to 96.06%
- Average per-repo reduction: 94.8%

| Project | Files scanned | Raw toks | Compact toks | Saved toks | Reduction | Bridge ms | Signals |
|---|---:|---:|---:|---:|---:|---:|---:|
| expressjs/express | 192 | 23936 | 1663 | 22273 | 93.05% | 104.74 | 4/4 |
| fastify/fastify | 385 | 41848 | 1649 | 40199 | 96.06% | 85.35 | 4/4 |
| colinhacks/zod | 570 | 35140 | 1654 | 33486 | 95.29% | 80.91 | 3/4 |

## Method

For each repo, the script downloads a public source archive, extracts it locally, builds a raw evidence bundle from file tree, package scripts, dependency names, grep-like code/test signals, README/docs, and selected source/test excerpts, then calls:

```bash
node scripts/localqa-opencode-runner.mjs
```

with `mode=context_cleanup`. That is the same bridge called by the OpenCode custom tool.

The raw baseline approximates the context a normal coding agent would accumulate by using file listing, package reads, docs reads, grep, and source/test file reads directly.

## Case details

## expressjs/express

- Source: https://codeload.github.com/expressjs/express/tar.gz/refs/heads/master
- Raw evidence file: `reports/localqa/opencode_oss_codebases_2026-05-05/expressjs_express/raw-codebase-evidence.txt`
- Files scanned: 192
- Selected mode: context_cleanup
- Bridge wall time: 104.74 ms
- Raw approx tokens: 23936
- Compact approx tokens: 1663
- Saved approx tokens: 22273
- Reduction: 93.05%
- Expected signal coverage: 4/4 (1)
- Matched signals: express, router, middleware, mocha
- Missing signals: none

Compact preview:

```text
Task: Analyze this Express OSS codebase evidence. Identify project purpose, likely test command, major source/test areas, and any high-signal maintenance risks. Do not quote raw files; compact to actionable codebase evidence.
Mode: context_cleanup
High-signal lines:
TASK: Analyze this Express OSS codebase evidence. Identify project purpose, likely test command, major source/test areas, and any high-signal maintenance risks. Do not quote raw files; compact to actionable codebase evidence.
package.json:94: "test": "mocha --require test/support/env --reporter spec --check-leaks test/ test/acceptance/",
examples/README.md:12: - [error](./error) - Working with error middleware
package.json:92: "lint": "eslint .",
examples/README.md:11: - [error-pages](./error-pages) - Creating error pages
package.json:97: "test-tap": "mocha --require test/support/env --reporter tap --check-leaks test/ test/acceptance/"
"test": "mocha --require test/support/env --reporter spec --check-leaks test/ test/acceptance/", [repeated 2x]
examples/web-service/index.js:34: if (!key) return next(error(400, 'api key required'));
examples/web-service/index.js:37: if (apiKeys.indexOf(key) === -1) return next(error(401, 'invalid api key'))
test/res.download.js:145: .expect('got 404 error')
test/res.sendFile.js:333: .expect('got 404 error')
test/res.sendFile.js:277: .expect(200, 'got 404 error', done)
test/app.routes.error.js:22: .expect(500, /Error: boom!/, done);
test/acceptance/mvc.js:96: it('should 500 on error', function(done){
test/res.render.js:128: .expect(500, 'got error: RenderError', done)
test/res.render.js:355: .expect(500, 'got error: RenderError', done)
test/res.render.js:123: res.status(500).send('got error: ' + err.name)
test/res.render.js:348: res.status(500).send('got error: ' + err.name)
t
```

## fastify/fastify

- Source: https://codeload.github.com/fastify/fastify/tar.gz/refs/heads/main
- Raw evidence file: `reports/localqa/opencode_oss_codebases_2026-05-05/fastify_fastify/raw-codebase-evidence.txt`
- Files scanned: 385
- Selected mode: context_cleanup
- Bridge wall time: 85.35 ms
- Raw approx tokens: 41848
- Compact approx tokens: 1649
- Saved approx tokens: 40199
- Reduction: 96.06%
- Expected signal coverage: 4/4 (1)
- Matched signals: fastify, plugin, schema, test
- Missing signals: none

Compact preview:

```text
Task: Analyze this Fastify OSS codebase evidence. Identify project purpose, likely test command, major source/test areas, and any high-signal maintenance risks. Do not quote raw files; compact to actionable codebase evidence.
Mode: context_cleanup
High-signal lines:
TASK: Analyze this Fastify OSS codebase evidence. Identify project purpose, likely test command, major source/test areas, and any high-signal maintenance risks. Do not quote raw files; compact to actionable codebase evidence.
package.json:25: "test:validator:integrity": "npm run build:validation && git diff --quiet --ignore-all-space --ignore-blank-lines --ignore-cr-at-eol lib/error-serializer.js && git diff --quiet --ignore-all-space --ignore-blank-lines --ignore-cr-at-eol lib/config-validator.js"
package.json:26: "test:typescript": "tsc test/types/import.ts --target es2022 --moduleResolution node16 --module node16 --noEmit && tsd",
"test:validator:integrity": "npm run build:validation && git diff --quiet --ignore-all-space --ignore-blank-lines --ignore-cr-at-eol lib/error-serializer.js && git diff --quiet --ignore-all-space --ignore-blank-lines --ignore-cr-at-eol lib/config-validator.js", [repeated 2x]
package.json:27: "test:watch": "npm run unit -- --watch --coverage-report=none --reporter=terse",
package.json:17: "lint": "npm run lint:eslint",
docs/Guides/Testing.md:183: // handle error
docs/Guides/Testing.md:193: // handle error
docs/Guides/Testing.md:79: const app = build()
docs/Guides/Testing.md:128: const app = build()
docs/Guides/Testing.md:57: server.log.error(err)
docs/Guides/Testing.md:38: module.exports = build
docs/Guides/Testing.md:29: function build(opts={}) {
docs/Guides/Testing.md:149: }, (error, response) => {
docs/Guides/Testing.md:76: const build = require('./app')
docs/Guides/Testing.md
```

## colinhacks/zod

- Source: https://codeload.github.com/colinhacks/zod/tar.gz/refs/heads/main
- Raw evidence file: `reports/localqa/opencode_oss_codebases_2026-05-05/colinhacks_zod/raw-codebase-evidence.txt`
- Files scanned: 570
- Selected mode: context_cleanup
- Bridge wall time: 80.91 ms
- Raw approx tokens: 35140
- Compact approx tokens: 1654
- Saved approx tokens: 33486
- Reduction: 95.29%
- Expected signal coverage: 3/4 (0.75)
- Matched signals: zod, schema, test
- Missing signals: typescript

Compact preview:

```text
Task: Analyze this Zod OSS codebase evidence. Identify project purpose, likely test command, major source/test areas, and any high-signal maintenance risks. Do not quote raw files; compact to actionable codebase evidence.
Mode: context_cleanup
High-signal lines:
TASK: Analyze this Zod OSS codebase evidence. Identify project purpose, likely test command, major source/test areas, and any high-signal maintenance risks. Do not quote raw files; compact to actionable codebase evidence.
packages/zod/package.json:132: "test": "pnpm vitest run",
packages/zod/package.json:131: "test:watch": "pnpm vitest",
packages/resolution/package.json:19: "test:all": "pnpm vitest run && tsx test-resolution.ts"
packages/integration/package.json:17: "test:source": "tsc --project fixtures/drizzle-zod/tsconfig.json 2>&1 | (! grep -q 'excessively deep') && tsc --project fixtures/ai-sdk/tsconfig.json",
packages/zod/package.json:129: "build": "zshy --project tsconfig.build.json",
packages/integration/package.json:18: "test:built": "tsc --project fixtures/internal-types/tsconfig.bundler.json && tsc --project fixtures/internal-types/tsconfig.nodenext.json && tsc --project fixtures/internal-types/tsconfig.node16-cjs.json"
packages/tsc/package.json:25: "build": "tsc",
packages/docs/package.json:6: "build": "next build",
package.json:76: "test": "vitest run",
package.json:75: "test:watch": "vitest",
package.json:74: "build": "pnpm run -r --filter zod build",
packages/docs-v3/README.md:273: Build AI apps and workflows with <a href="https://retool.com/products/ai?utm_source=github&utm_medium=referral&utm_campaign=zod">Retool AI</a>
packages/zod/README.md:149: result.error; // ZodError instance
packages/docs-v3/README.md:148: - [Error handling](#error-handling)
packages/docs-v3/README.md:149: - [Error format
```


## Defensible claims

Safe to claim from this run:

- LocalQA's OpenCode bridge compressed real OSS codebase evidence by 93.05% to 96.06% in this 3-repo run.
- Total measured reduction was 95.08%: 100924 raw approx tokens to 4966 compact approx tokens.
- The benchmark used public source archives, not synthetic repo text.

Do not claim:

- This proves code understanding quality equals a frontier model.
- This prevents secrets pasted into the initial user prompt.
- These exact ratios apply to every repo or every task.

## Live OpenCode plugin-path sample

After the deterministic bridge benchmark, I ran one live OpenCode model session against the generated Fastify evidence file.

Session: `ses_209a64b68ffeHa6gx70GvSvRpU`

Prompt constraints:

- Use `local_agent_run` exactly once.
- Do not use `read`, `bash`, `grep`, `cat`, or `webfetch`.
- Read the OSS evidence through `filePath` only.
- Use `mode=context_cleanup` and `contextBudgetTokens=1600`.

Result: pass.

Tool result:

```json
{
  "selectedMode": "context_cleanup",
  "telemetry": {
    "externalCalls": 0,
    "localFileInputCount": 1,
    "localFileInputBytes": 167490
  },
  "tokenSavings": {
    "rawEvidenceApproxTokens": 41857,
    "compactReportApproxTokens": 1673,
    "savedApproxTokens": 40184,
    "reductionRatio": 96
  }
}
```

The final model answer correctly summarized:

- Fastify project purpose.
- Test command signals from `package.json`.
- Source/test areas such as `lib/`, `test/`, bundler tests, and validation build artifacts.
- Maintenance risks around validator integrity checks, TypeScript surface checks, bundler compatibility, and broad test matrix complexity.

Presentation caveat: the model wrote `96x` in one sentence even though the tool value is `96%`. Public copy should use the tool JSON value, not model phrasing.

## Implementation change from this benchmark

The first live sample showed that generic cleanup over-weighted lines containing `error` and under-weighted package/test/source structure. I added codebase-aware scoring in `localqa/core/context-core.mjs` for codebase/repo/source/test tasks. After that change:

- Express signal coverage improved from 3/4 to 4/4.
- Fastify stayed 4/4.
- Zod stayed 3/4 because the compact text did not include the literal expected word `typescript`.
- Compression remained in the same range.

Validation after the scorer change:

```text
npm test: 81/81 pass
npm run localqa:validate: pass, strict surface ["local_agent_run"]
```

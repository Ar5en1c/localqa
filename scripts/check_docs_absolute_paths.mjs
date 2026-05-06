import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const thisFile = fileURLToPath(import.meta.url);
const scriptsDir = path.dirname(thisFile);
const rootDir = path.resolve(scriptsDir, '..');

const rootDocs = [
  'README.md',
  'CONTRIBUTING.md',
  'MLC_TURBOQUANT_BLUEPRINT.md',
  'USING_WITH_CURRENT_MLC_INSTRUCT_MODEL.md',
];

const markdownRoots = ['docs', 'mlc-fork'];

function collectMarkdownFiles(startDir) {
  const files = [];
  if (!fs.existsSync(startDir)) return files;

  for (const entry of fs.readdirSync(startDir, { withFileTypes: true })) {
    const fullPath = path.resolve(startDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectMarkdownFiles(fullPath));
      continue;
    }
    if (entry.isFile() && fullPath.endsWith('.md')) {
      files.push(fullPath);
    }
  }

  return files;
}

const filesToCheck = [
  ...rootDocs.map((f) => path.resolve(rootDir, f)).filter((f) => fs.existsSync(f)),
  ...markdownRoots.flatMap((dir) => collectMarkdownFiles(path.resolve(rootDir, dir))),
];

const deniedPatterns = [
  /\/Users\/[^\s)`"']+/g,
  /\/home\/[^\s)`"']+/g,
  /[A-Za-z]:\\[^\s)`"']+/g,
  /file:\/\/[^\s)`"']+/g,
];

const offenders = [];
for (const file of filesToCheck) {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    for (const pattern of deniedPatterns) {
      pattern.lastIndex = 0;
      if (pattern.test(line)) {
        offenders.push({
          file: path.relative(rootDir, file),
          line: i + 1,
          content: line.trim(),
        });
        break;
      }
    }
  }
}

if (offenders.length > 0) {
  console.error('Found machine-local absolute paths in docs:');
  for (const offender of offenders) {
    console.error(`- ${offender.file}:${offender.line} ${offender.content}`);
  }
  process.exit(1);
}

console.log(`Docs path hygiene check passed (${filesToCheck.length} markdown files scanned).`);

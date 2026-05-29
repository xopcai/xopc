#!/usr/bin/env node
/**
 * Drop `export` from symbols flagged by react-doctor deslop/unused-export.
 * One-off helper for Dead Code cleanup — safe to delete after use.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.join(__dirname, '..');

const diagPath = process.argv[2];
if (!diagPath) {
  console.error('Usage: node fix-unused-exports.mjs <diagnostics.json>');
  process.exit(1);
}

const diagnostics = JSON.parse(fs.readFileSync(diagPath, 'utf8'));
const items = diagnostics.filter((d) => d.rule === 'unused-export');

const byFile = new Map();
for (const item of items) {
  const list = byFile.get(item.filePath) ?? [];
  list.push(item);
  byFile.set(item.filePath, list);
}

function dropExportOnLine(line) {
  if (/^export\s+default\s/.test(line)) {
    return line.replace(/^export\s+default\s+/, '');
  }
  if (/^export\s+async\s+function\s/.test(line)) {
    return line.replace(/^export\s+async\s+function\s/, 'async function ');
  }
  if (/^export\s+function\s/.test(line)) {
    return line.replace(/^export\s+function\s/, 'function ');
  }
  if (/^export\s+const\s/.test(line)) {
    return line.replace(/^export\s+const\s/, 'const ');
  }
  if (/^export\s+let\s/.test(line)) {
    return line.replace(/^export\s+let\s/, 'let ');
  }
  if (/^export\s+var\s/.test(line)) {
    return line.replace(/^export\s+var\s/, 'var ');
  }
  if (/^export\s+type\s/.test(line)) {
    return line.replace(/^export\s+type\s/, 'type ');
  }
  if (/^export\s+interface\s/.test(line)) {
    return line.replace(/^export\s+interface\s/, 'interface ');
  }
  if (/^export\s+enum\s/.test(line)) {
    return line.replace(/^export\s+enum\s/, 'enum ');
  }
  if (/^export\s+class\s/.test(line)) {
    return line.replace(/^export\s+class\s/, 'class ');
  }
  // inline: export function Foo or export const Foo mid-line (rare)
  return line
    .replace(/\bexport\s+async\s+function\s/g, 'async function ')
    .replace(/\bexport\s+function\s/g, 'function ')
    .replace(/\bexport\s+const\s/g, 'const ')
    .replace(/\bexport\s+type\s/g, 'type ');
}

let changedFiles = 0;
for (const [relPath, fileItems] of byFile) {
  const absPath = path.join(webRoot, relPath);
  if (!fs.existsSync(absPath)) {
    console.warn('skip missing', relPath);
    continue;
  }
  const lines = fs.readFileSync(absPath, 'utf8').split('\n');
  const lineNums = [...new Set(fileItems.map((i) => i.line))].sort((a, b) => b - a);
  let touched = false;
  for (const lineNum of lineNums) {
    const idx = lineNum - 1;
    if (idx < 0 || idx >= lines.length) continue;
    const before = lines[idx];
    const after = dropExportOnLine(before);
    if (after !== before) {
      lines[idx] = after;
      touched = true;
    }
  }
  if (touched) {
    fs.writeFileSync(absPath, lines.join('\n'));
    changedFiles += 1;
    console.log('fixed', relPath, `(${lineNums.length} lines)`);
  }
}

console.log(`Done: ${changedFiles} files updated.`);

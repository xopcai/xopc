#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const failures = [];

function fail(message) {
  failures.push(message);
}

function markdownFilesFromGit() {
  const output = execFileSync('git', ['ls-files', 'docs/**/*.md', 'README.md', 'README.zh-CN.md'], {
    cwd: root,
    encoding: 'utf8',
  });
  return output.split('\n').filter(Boolean);
}

function findJsonBlocks(markdown) {
  const blocks = [];
  const fence = /^```([A-Za-z0-9_-]+)?[^\n]*\n([\s\S]*?)^```/gm;
  let match;
  while ((match = fence.exec(markdown)) !== null) {
    const lang = (match[1] ?? '').toLowerCase();
    if (lang === 'json' || lang === 'jsonc') {
      const line = markdown.slice(0, match.index).split('\n').length;
      blocks.push({ line, lang, source: match[2] });
    }
  }
  return blocks;
}

function stripJsonComments(source) {
  let output = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];
    if (inString) {
      output += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      output += ch;
      continue;
    }
    if (ch === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i += 1;
      output += '\n';
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        output += source[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      i += 1;
      continue;
    }
    output += ch;
  }
  return output;
}

function detectDuplicateKeys(source) {
  const duplicates = [];
  const stack = [];
  let i = 0;

  function skipWhitespace() {
    while (i < source.length && /\s/.test(source[i])) i += 1;
  }

  function readString() {
    let value = '';
    i += 1;
    while (i < source.length) {
      const ch = source[i];
      if (ch === '\\') {
        value += ch + (source[i + 1] ?? '');
        i += 2;
        continue;
      }
      if (ch === '"') {
        i += 1;
        return value;
      }
      value += ch;
      i += 1;
    }
    return value;
  }

  while (i < source.length) {
    const ch = source[i];
    if (ch === '"') {
      const start = i;
      const value = readString();
      skipWhitespace();
      if (source[i] === ':' && stack.at(-1)?.type === 'object') {
        const frame = stack.at(-1);
        if (frame.keys.has(value)) {
          duplicates.push({ key: value, offset: start });
        }
        frame.keys.add(value);
      }
      continue;
    }
    if (ch === '{') {
      stack.push({ type: 'object', keys: new Set() });
    } else if (ch === '[') {
      stack.push({ type: 'array' });
    } else if (ch === '}' || ch === ']') {
      stack.pop();
    }
    i += 1;
  }

  return duplicates;
}

function checkJsonBlocks() {
  for (const file of markdownFilesFromGit()) {
    const fullPath = join(root, file);
    const markdown = readFileSync(fullPath, 'utf8');
    for (const block of findJsonBlocks(markdown)) {
      const json = block.lang === 'jsonc' ? stripJsonComments(block.source) : block.source;
      try {
        JSON.parse(json);
      } catch (error) {
        fail(`${file}:${block.line} JSON block does not parse: ${error.message}`);
        continue;
      }
      const duplicates = detectDuplicateKeys(json);
      for (const duplicate of duplicates) {
        const line = block.line + json.slice(0, duplicate.offset).split('\n').length - 1;
        fail(`${file}:${line} JSON block repeats key "${duplicate.key}"`);
      }
    }
  }
}

function parseCliOverviewCommands() {
  const cliDoc = readFileSync(join(root, 'docs/cli.md'), 'utf8');
  const commands = [];
  let inTable = false;
  for (const line of cliDoc.split('\n')) {
    if (line.trim() === '| Command | Description |') {
      inTable = true;
      continue;
    }
    if (!inTable) continue;
    if (line.trim().startsWith('|---------')) continue;
    if (!line.trim().startsWith('|')) break;
    const match = line.match(/^\|\s*`([^`]+)`\s*\|/);
    if (match) commands.push(match[1]);
  }
  return commands;
}

function parseHelpCommands(helpText) {
  const commands = [];
  let inCommands = false;
  for (const line of helpText.split('\n')) {
    if (line.trim() === 'Commands:') {
      inCommands = true;
      continue;
    }
    if (!inCommands) continue;
    const match = line.match(/^\s{2}([a-z][a-z-]*)\b/);
    if (match && match[1] !== 'help') commands.push(match[1]);
  }
  return commands;
}

function checkCliOverview() {
  const help = execFileSync('pnpm', ['run', 'dev', '--', '--help'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const docsCommands = parseCliOverviewCommands();
  const helpCommands = parseHelpCommands(help);
  const missing = helpCommands.filter((command) => !docsCommands.includes(command));
  const extra = docsCommands.filter((command) => !helpCommands.includes(command));
  if (missing.length > 0) {
    fail(`docs/cli.md command overview misses root commands: ${missing.join(', ')}`);
  }
  if (extra.length > 0) {
    fail(`docs/cli.md command overview lists unknown root commands: ${extra.join(', ')}`);
  }
}

checkJsonBlocks();
checkCliOverview();

if (failures.length > 0) {
  console.error('Docs check failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('Docs check passed.');

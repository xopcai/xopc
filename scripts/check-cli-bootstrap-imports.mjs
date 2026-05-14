#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

// Cold-start dependencies that bin.ts and the gateway command must never pull
// in statically — these own the heavy module graphs (gateway server, agent
// service, channel manager, providers, bundled extension plugins).
const COLD_START_PATTERNS = [
  /^\.\/index\.js$/,
  /\.\.\/\.\.\/gateway\/index\.js/,
  /\.\.\/\.\.\/gateway\/service\.js/,
  /\.\.\/\.\.\/agent\/service\.js/,
  /\.\.\/\.\.\/channels\/manager\.js/,
  /\.\.\/\.\.\/generated\/bundled-channel-plugins\.js/,
  /\.\.\/\.\.\/providers\/index\.js/,
];

// Per-file rules: each bootstrap file has its own forbidden static imports.
const RULES = [
  { file: 'src/cli/bin.ts', forbidden: COLD_START_PATTERNS },
  { file: 'src/cli/commands/gateway.ts', forbidden: COLD_START_PATTERNS },
  {
    file: 'src/cli/index.ts',
    forbidden: [
      /^\.\/commands\//,
      /^\.\/extension-cli-register\.js$/,
      // Logger barrel pulls pino + 8 sub-modules; --help / --version paths
      // never log, so this stays dynamic. Direct sub-paths under
      // `../utils/logger/` are allowed (e.g. `logger/shutdown.js`).
      /^\.\.\/utils\/logger\.js$/,
    ],
  },
];

// Captures `import x from "..."`, `export ... from "..."`, and side-effect
// `import "..."` (without `from`). Excludes dynamic `import(...)`.
const STATIC_IMPORT_RE =
  /\bimport\s+(?!\()[^'";]*?from\s+["'](?<specifier>[^"']+)["']|\bexport\s+[^'";]*?from\s+["'](?<exportSpecifier>[^"']+)["']|\bimport\s+["'](?<sideEffect>[^"']+)["']/gu;

function listStaticImports(source) {
  return [...source.matchAll(STATIC_IMPORT_RE)]
    .map(
      (match) =>
        match.groups?.specifier ?? match.groups?.exportSpecifier ?? match.groups?.sideEffect ?? '',
    )
    .filter(Boolean);
}

function collectErrors(rootDir = process.cwd()) {
  const errors = [];
  for (const rule of RULES) {
    const absolutePath = path.resolve(rootDir, rule.file);
    let source = '';
    try {
      source = fs.readFileSync(absolutePath, 'utf8');
    } catch {
      errors.push(`Missing bootstrap file: ${rule.file}`);
      continue;
    }
    for (const specifier of listStaticImports(source)) {
      const forbidden = rule.forbidden.find((pattern) => pattern.test(specifier));
      if (forbidden) {
        errors.push(`${rule.file} statically imports cold startup path "${specifier}".`);
      }
    }
  }
  return errors;
}

const errors = collectErrors();
if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('CLI bootstrap import guard passed');

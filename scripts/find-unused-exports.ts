#!/usr/bin/env node
/**
 * Finds unused exports (interfaces, types, consts, functions, classes) in src/
 *
 * Features:
 * - Detects unused exports across all .ts files in src/
 * - Transitive unused detection: if A is only used by B, and B is unused, A is also unused
 * - Excludes test files (__tests__/)
 * - Groups results by file for easy navigation
 *
 * Usage:
 * npx tsx scripts/find-unused-exports.ts
 * npx tsx scripts/find-unused-exports.ts --verbose
 * npx tsx scripts/find-unused-exports.ts --json
 */
import * as fs from 'fs';
import * as path from 'path';

const SRC_DIR = path.resolve(process.cwd(), 'src');
const VERBOSE = process.argv.includes('--verbose');
const JSON_OUTPUT = process.argv.includes('--json');

// ─── Types ────────────────────────────────────────────────────────────────────
interface ExportedSymbol {
  name: string;
  kind: 'interface' | 'type' | 'const' | 'function' | 'class' | 'enum' | 'variable';
  filePath: string;
  line: number;
}

interface AnalysisResult {
  unused: ExportedSymbol[];
  total: number;
  usedCount: number;
}

// ─── File Collection ──────────────────────────────────────────────────────────
function collectTsFiles(dir: string): string[] {
  const results: string[] = [];
  function walk(currentDir: string) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
        walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
        results.push(fullPath);
      }
    }
  }
  walk(dir);
  return results;
}

// ─── Export Extraction ────────────────────────────────────────────────────────
const EXPORT_PATTERNS: Array<{ pattern: RegExp; kind: ExportedSymbol['kind'] }> = [
  { pattern: /^export\s+(?:declare\s+)?interface\s+(\w+)/m, kind: 'interface' },
  { pattern: /^export\s+(?:declare\s+)?type\s+(\w+)\s*[=<{]/m, kind: 'type' },
  { pattern: /^export\s+(?:declare\s+)?(?:abstract\s+)?class\s+(\w+)/m, kind: 'class' },
  { pattern: /^export\s+(?:declare\s+)?enum\s+(\w+)/m, kind: 'enum' },
  { pattern: /^export\s+(?:declare\s+)?function\s+(\w+)/m, kind: 'function' },
  { pattern: /^export\s+(?:declare\s+)?async\s+function\s+(\w+)/m, kind: 'function' },
  { pattern: /^export\s+(?:declare\s+)?const\s+(\w+)/m, kind: 'const' },
  { pattern: /^export\s+(?:declare\s+)?let\s+(\w+)/m, kind: 'variable' },
  { pattern: /^export\s+(?:declare\s+)?var\s+(\w+)/m, kind: 'variable' },
];

// Matches: export { Foo, Bar as Baz }
const NAMED_EXPORT_RE = /^export\s*\{([^}]+)\}/gm;
// Matches: export * from '...' or export { X } from '...'
const RE_EXPORT_RE = /^export\s+(?:\*|\{[^}]*\})\s+from\s+['"][^'"]+['"]/gm;
// Matches: export default ...
const DEFAULT_EXPORT_RE = /^export\s+default\s+(\w+)/gm;

function extractExports(filePath: string, content: string): ExportedSymbol[] {
  const symbols: ExportedSymbol[] = [];
  const lines = content.split('\n');

  // Line-by-line scan for direct export declarations
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    
    // Skip re-exports (export { X } from '...' and export * from '...')
    if (/^export\s+(?:\*|\{[^}]*\})\s+from\s+['"]/.test(line)) continue;

    for (const { pattern, kind } of EXPORT_PATTERNS) {
      const match = line.match(pattern);
      if (match) {
        symbols.push({ name: match[1], kind, filePath, line: lineIndex + 1 });
        break;
      }
    }

    // export { Foo, Bar } (without from)
    if (/^export\s*\{/.test(line) && !/from\s+['"]/.test(line)) {
      const blockMatch = line.match(/^export\s*\{([^}]+)\}/);
      if (blockMatch) {
        const names = blockMatch[1].split(',').map((s) => s.trim().split(/\s+as\s+/).pop()!.trim());
        for (const name of names) {
          if (name && /^\w+$/.test(name)) {
            symbols.push({ name, kind: 'const', filePath, line: lineIndex + 1 });
          }
        }
      }
    }
  }

  return symbols;
}

// ─── Usage Detection ──────────────────────────────────────────────────────────
/**
 * Builds a map of symbol name → set of files that reference it.
 * We scan all files for identifier usage (not just imports).
 */
function buildUsageMap(files: string[], allContent: Map<string, string>): Map<string, Set<string>> {
  const usageMap = new Map<string, Set<string>>();
  
  for (const filePath of files) {
    const content = allContent.get(filePath)!;
    
    // Extract all identifiers referenced in this file
    // We look for word boundaries to avoid partial matches
    const identifierRe = /\b([A-Za-z_$][A-Za-z0-9_$]*)\b/g;
    let match: RegExpExecArray | null;
    
    while ((match = identifierRe.exec(content)) !== null) {
      const name = match[1];
      if (!usageMap.has(name)) {
        usageMap.set(name, new Set());
      }
      usageMap.get(name)!.add(filePath);
    }
  }
  
  return usageMap;
}

// ─── Transitive Unused Detection ──────────────────────────────────────────────
/**
 * Determines which symbols are truly unused, considering transitive references.
 *
 * Algorithm:
 * 1. Mark symbols that are only referenced within their own defining file as "potentially unused"
 * 2. Iteratively propagate: if a symbol is only used by other unused symbols, mark it unused too
 */
function findUnusedSymbols(
  allSymbols: ExportedSymbol[],
  usageMap: Map<string, Set<string>>,
): ExportedSymbol[] {
  // Build a lookup: name → symbol (for exported symbols only)
  const exportedNames = new Set(allSymbols.map((s) => s.name));

  // For each exported symbol, find which files use it (excluding its own file)
  function getExternalUsageFiles(symbol: ExportedSymbol): Set<string> {
    const usedInFiles = usageMap.get(symbol.name) ?? new Set();
    const external = new Set<string>();
    for (const file of usedInFiles) {
      if (file !== symbol.filePath) {
        external.add(file);
      }
    }
    return external;
  }

  // Initial pass: symbols with no external usage are candidates
  const unusedCandidates = new Set<string>();
  for (const symbol of allSymbols) {
    const externalFiles = getExternalUsageFiles(symbol);
    if (externalFiles.size === 0) {
      unusedCandidates.add(symbol.name);
    }
  }

  // Transitive pass: if a symbol is only used in files that only contain unused symbols,
  // mark it as unused too. We iterate until stable.
  let changed = true;
  while (changed) {
    changed = false;
    for (const symbol of allSymbols) {
      if (unusedCandidates.has(symbol.name)) continue;

      const externalFiles = getExternalUsageFiles(symbol);
      
      // Check if all external usages come from files that only define unused symbols
      let allUsersAreUnused = true;
      for (const usingFile of externalFiles) {
        // Find exported symbols defined in this using file
        const symbolsInUsingFile = allSymbols.filter((s) => s.filePath === usingFile);
        
        if (symbolsInUsingFile.length === 0) {
          // The file has no exports but uses our symbol — it's an "entry" file (e.g. CLI commands)
          allUsersAreUnused = false;
          break;
        }

        // Check if all symbols in the using file are themselves unused
        const allUnused = symbolsInUsingFile.every((s) => unusedCandidates.has(s.name));
        if (!allUnused) {
          allUsersAreUnused = false;
          break;
        }
      }

      if (allUsersAreUnused && externalFiles.size > 0) {
        unusedCandidates.add(symbol.name);
        changed = true;
      }
    }
  }

  return allSymbols.filter((s) => unusedCandidates.has(s.name));
}

// ─── Main ─────────────────────────────────────────────────────────────────────
function main(): void {
  console.log(`🔍 Scanning ${SRC_DIR}...\n`);

  const files = collectTsFiles(SRC_DIR);
  console.log(`📁 Found ${files.length} TypeScript files\n`);

  // Read all file contents
  const allContent = new Map<string, string>();
  for (const filePath of files) {
    allContent.set(filePath, fs.readFileSync(filePath, 'utf-8'));
  }

  // Extract all exported symbols
  const allSymbols: ExportedSymbol[] = [];
  for (const filePath of files) {
    const content = allContent.get(filePath)!;
    const symbols = extractExports(filePath, content);
    allSymbols.push(...symbols);
  }
  console.log(`📦 Found ${allSymbols.length} exported symbols total\n`);

  // Build usage map across all files
  const usageMap = buildUsageMap(files, allContent);

  // Find unused symbols (with transitive detection)
  const unusedSymbols = findUnusedSymbols(allSymbols, usageMap);

  const result: AnalysisResult = {
    unused: unusedSymbols,
    total: allSymbols.length,
    usedCount: allSymbols.length - unusedSymbols.length,
  };

  if (JSON_OUTPUT) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  // ─── Pretty Output ──────────────────────────────────────────────────────────
  if (unusedSymbols.length === 0) {
    console.log('✅ No unused exports found!\n');
    return;
  }

  // Group by file
  const byFile = new Map<string, ExportedSymbol[]>();
  for (const symbol of unusedSymbols) {
    if (!byFile.has(symbol.filePath)) byFile.set(symbol.filePath, []);
    byFile.get(symbol.filePath)!.push(symbol);
  }

  // Sort files by number of unused symbols (most first)
  const sortedFiles = [...byFile.entries()].sort((a, b) => b[1].length - a[1].length);

  const kindEmoji: Record<ExportedSymbol['kind'], string> = {
    interface: '🔷',
    type: '🔶',
    const: '📌',
    function: '⚡',
    class: '🏛️',
    enum: '📋',
    variable: '📌',
  };

  for (const [filePath, symbols] of sortedFiles) {
    const relativePath = path.relative(process.cwd(), filePath);
    console.log(`📄 ${relativePath} (${symbols.length} unused)`);
    console.log('─'.repeat(60));
    for (const symbol of symbols.sort((a, b) => a.line - b.line)) {
      const emoji = kindEmoji[symbol.kind];
      console.log(`  ${emoji} ${symbol.kind.padEnd(10)} ${symbol.name.padEnd(40)} line ${symbol.line}`);
    }
    console.log();
  }

  console.log(' ' + '═'.repeat(60));
  console.log(`📊 Summary:`);
  console.log(`  Total exported symbols : ${result.total}`);
  console.log(`  Used                   : ${result.usedCount}`);
  console.log(`  Unused                 : ${unusedSymbols.length}`);
  console.log(`  Files with unused      : ${byFile.size}`);
  console.log('═'.repeat(60) + '\n');

  if (VERBOSE) {
    console.log('💡 Tip: These symbols are exported but never imported/used anywhere in src/');
    console.log('   They may be safe to remove, or they might be used by external consumers.\n');
  }
}

main();

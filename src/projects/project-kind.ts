import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { canonicalWorkspacePath } from './workspace-project.js';
import type { ProjectExecutionMode } from './types.js';

export type ProjectKind = 'coding' | 'general' | 'unknown';
export type ProjectKindOverride = 'auto' | 'coding' | 'general';

export type ProjectKindInference = {
  kind: ProjectKind;
  confidence: number;
  reasons: string[];
};

const STRONG_CODE_MARKERS = [
  'package.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'package-lock.json',
  'tsconfig.json',
  'go.mod',
  'Cargo.toml',
  'pyproject.toml',
  'requirements.txt',
  'pom.xml',
  'build.gradle',
  'Makefile',
  'Dockerfile',
  'deno.json',
  'deno.jsonc',
  'composer.json',
  'Gemfile',
] as const;

const WEAK_CODE_DIRECTORIES = ['src', 'app', 'lib', 'tests', 'test', '__tests__', '.github'] as const;
const CODE_EXTENSIONS = new Set([
  '.c',
  '.cc',
  '.cpp',
  '.cs',
  '.css',
  '.go',
  '.h',
  '.hpp',
  '.html',
  '.java',
  '.js',
  '.jsx',
  '.kt',
  '.mjs',
  '.php',
  '.py',
  '.rb',
  '.rs',
  '.sh',
  '.swift',
  '.ts',
  '.tsx',
]);

function normalizeOverride(value: string | null | undefined): ProjectKindOverride {
  const normalized = value?.trim().toLowerCase();
  return normalized === 'coding' || normalized === 'general' ? normalized : 'auto';
}

function hasSourceExtension(name: string): boolean {
  const lower = name.toLowerCase();
  for (const extension of CODE_EXTENSIONS) {
    if (lower.endsWith(extension)) return true;
  }
  return false;
}

function readDirectoryNames(pathValue: string): string[] {
  try {
    return readdirSync(pathValue).slice(0, 200);
  } catch {
    return [];
  }
}

function directoryExists(pathValue: string): boolean {
  try {
    return statSync(pathValue).isDirectory();
  } catch {
    return false;
  }
}

export function inferProjectKind(input: {
  name?: string | null;
  description?: string | null;
  workspaceRoot?: string | null;
  projectKind?: string | null;
}): ProjectKindInference {
  const override = normalizeOverride(input.projectKind);
  if (override === 'coding') return { kind: 'coding', confidence: 1, reasons: ['selected coding project type'] };
  if (override === 'general') return { kind: 'general', confidence: 1, reasons: ['selected general project type'] };

  const workspaceRoot = canonicalWorkspacePath(input.workspaceRoot);
  const reasons: string[] = [];
  let score = 0;

  if (workspaceRoot && directoryExists(workspaceRoot)) {
    for (const marker of STRONG_CODE_MARKERS) {
      if (existsSync(join(workspaceRoot, marker))) {
        score += 4;
        reasons.push(`found ${marker}`);
        break;
      }
    }

    for (const dir of WEAK_CODE_DIRECTORIES) {
      if (directoryExists(join(workspaceRoot, dir))) {
        score += 1;
        reasons.push(`found ${dir}/`);
        break;
      }
    }

    if (readDirectoryNames(workspaceRoot).some(hasSourceExtension)) {
      score += 2;
      reasons.push('found source files');
    } else {
      for (const dir of ['src', 'app', 'lib']) {
        const childDir = join(workspaceRoot, dir);
        if (directoryExists(childDir) && readDirectoryNames(childDir).some(hasSourceExtension)) {
          score += 2;
          reasons.push(`found source files in ${dir}/`);
          break;
        }
      }
    }
  }

  if (score >= 4) return { kind: 'coding', confidence: 0.9, reasons };
  if (score >= 3) return { kind: 'coding', confidence: 0.75, reasons };
  if (workspaceRoot) return { kind: 'general', confidence: 0.55, reasons };
  return { kind: 'unknown', confidence: 0.25, reasons };
}

export function inferProjectExecutionMode(input: {
  name?: string | null;
  description?: string | null;
  workspaceRoot?: string | null;
  projectKind?: string | null;
}): ProjectExecutionMode {
  const workspaceRoot = canonicalWorkspacePath(input.workspaceRoot);
  if (!workspaceRoot || !existsSync(join(workspaceRoot, '.git'))) return 'local_checkout';
  return inferProjectKind(input).kind === 'coding' ? 'managed_worktree' : 'local_checkout';
}

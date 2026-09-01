import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';

import { resolveSkillsDir } from '../../config/paths.js';
import { resolveWorkspaceSkillsDir } from './workspace-skills-dir.js';
import type {
  SkillDiagnostic,
  SkillOriginId,
  SkillSourceDescriptor,
  SkillsConfig,
} from './types.js';

const PRIORITY = {
  extra: 100,
  bundled: 200,
  agentsGlobal: 300,
  xopcGlobalCustom: 390,
  xopcGlobal: 400,
  agentsWorkspace: 450,
  xopcWorkspace: 500,
} as const;

export interface ResolveSkillSourcesOptions {
  workspaceDir?: string;
  globalDir?: string;
  builtinDir?: string;
  agentsDir?: string;
  extraDirs?: string[];
  /** Project compatibility sources fail closed unless trust is explicitly granted. */
  workspaceTrust?: 'trusted' | 'untrusted';
}

export interface ResolveSkillSourcesResult {
  sources: SkillSourceDescriptor[];
  diagnostics: SkillDiagnostic[];
}

function canonicalRoot(rootDir: string): string {
  const absolute = resolve(rootDir);
  if (!existsSync(absolute)) return absolute;
  try {
    return realpathSync(absolute);
  } catch {
    return absolute;
  }
}

function descriptor(options: {
  id: SkillOriginId;
  rootDir: string;
  priority: number;
  scope: SkillSourceDescriptor['scope'];
  managed: boolean;
  writable: boolean;
}): SkillSourceDescriptor {
  return {
    ...options,
    rootDir: canonicalRoot(options.rootDir),
  };
}

function dedupeSources(sources: SkillSourceDescriptor[]): SkillSourceDescriptor[] {
  const byRoot = new Map<string, SkillSourceDescriptor>();
  for (const source of sources) {
    const existing = byRoot.get(source.rootDir);
    if (!existing || source.priority > existing.priority) {
      byRoot.set(source.rootDir, source);
    }
  }
  return [...byRoot.values()].sort((a, b) => a.priority - b.priority);
}

function isSameOrInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

export function resolveSkillSources(
  options: ResolveSkillSourcesOptions,
  skillsConfig: SkillsConfig,
): ResolveSkillSourcesResult {
  const configuredExtraDirs = Array.isArray(skillsConfig.load?.extraDirs)
    ? skillsConfig.load.extraDirs.filter(
        (dir): dir is string => typeof dir === 'string' && dir.trim().length > 0,
      )
    : [];
  const optionExtraDirs = Array.isArray(options.extraDirs)
    ? options.extraDirs.filter((dir) => typeof dir === 'string' && dir.trim().length > 0)
    : [];
  const extraDirs = [...configuredExtraDirs, ...optionExtraDirs];
  const sources: SkillSourceDescriptor[] = [];
  const diagnostics: SkillDiagnostic[] = [];

  for (const rootDir of extraDirs) {
    sources.push(descriptor({
      id: 'extra',
      rootDir,
      priority: PRIORITY.extra,
      scope: 'extra',
      managed: false,
      writable: false,
    }));
  }

  if (options.builtinDir) {
    sources.push(descriptor({
      id: 'bundled',
      rootDir: options.builtinDir,
      priority: PRIORITY.bundled,
      scope: 'builtin',
      managed: false,
      writable: false,
    }));
  }

  if (skillsConfig.load?.sources?.agentsGlobal?.enabled !== false) {
    sources.push(descriptor({
      id: 'agents-global',
      rootDir: options.agentsDir ?? resolveAgentsSkillsDir(),
      priority: PRIORITY.agentsGlobal,
      scope: 'global',
      managed: false,
      writable: false,
    }));
  }

  if (options.globalDir) {
    sources.push(descriptor({
      id: 'custom-global',
      rootDir: options.globalDir,
      priority: PRIORITY.xopcGlobalCustom,
      scope: 'global',
      managed: false,
      writable: false,
    }));
  }

  sources.push(descriptor({
    id: 'xopc-global',
    rootDir: resolveSkillsDir(),
    priority: PRIORITY.xopcGlobal,
    scope: 'global',
    managed: true,
    writable: true,
  }));

  if (options.workspaceDir) {
    const canonicalWorkspace = canonicalRoot(options.workspaceDir);
    const agentsGlobalRoot = canonicalRoot(options.agentsDir ?? resolveAgentsSkillsDir());
    const workspaceAgentsRoot = canonicalRoot(resolveWorkspaceAgentsSkillsDir(options.workspaceDir));
    const agentsWorkspaceEnabled = skillsConfig.load?.sources?.agentsWorkspace?.enabled !== false;

    if (
      agentsWorkspaceEnabled &&
      workspaceAgentsRoot !== agentsGlobalRoot &&
      existsSync(workspaceAgentsRoot)
    ) {
      if (!isSameOrInside(canonicalWorkspace, workspaceAgentsRoot)) {
        diagnostics.push({
          type: 'warning',
          path: workspaceAgentsRoot,
          message: `Skipped agents-workspace skill source outside workspace: ${workspaceAgentsRoot}`,
        });
      } else if (options.workspaceTrust !== 'trusted') {
        diagnostics.push({
          type: 'skipped',
          path: workspaceAgentsRoot,
          message: `Skipped agents-workspace skill source because workspace is not trusted: ${workspaceAgentsRoot}`,
        });
      } else {
        sources.push(descriptor({
          id: 'agents-workspace',
          rootDir: workspaceAgentsRoot,
          priority: PRIORITY.agentsWorkspace,
          scope: 'workspace',
          managed: false,
          writable: false,
        }));
      }
    }

    sources.push(descriptor({
      id: 'xopc-workspace',
      rootDir: resolveWorkspaceSkillsDir(options.workspaceDir),
      priority: PRIORITY.xopcWorkspace,
      scope: 'workspace',
      managed: true,
      writable: true,
    }));
  }

  return { sources: dedupeSources(sources), diagnostics };
}

export function resolveAgentsSkillsDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.HOME || homedir(), '.agents', 'skills');
}

export function resolveWorkspaceAgentsSkillsDir(workspaceDir: string): string {
  return join(workspaceDir, '.agents', 'skills');
}

import { stat } from 'node:fs/promises';
import { basename, isAbsolute, resolve } from 'node:path';

import { resolveAgentProfileDir } from '../agent/agent-scope.js';
import {
  isBareProfileMarkdownFileName,
  resolveProfileMarkdownPathIfBareName,
} from '../agent/tools/tool-paths.js';
import { extractProfileAgentId } from '../config/agent-profile.js';
import { resolveConfigPath, resolveSessionsDir, resolveSkillsDir } from '../config/paths.js';
import { resolveStateDir } from '../config/paths-state.js';
import type { Config } from '../config/schema.js';
import { isPathUnderWorkspace, resolveWorkspaceSafePath } from './workspace-editor-path.js';
import type { FileReferenceLocationKind, FileReferenceScope } from './file-reference-registry.js';

export type { FileReferenceLocationKind };

export interface FilePathClassifierContext {
  workspaceRoot: string;
  profileMarkdownRoot?: string;
  stateDir: string;
  skillsDir: string;
  configFilePath: string;
  agentsHomeDir: string;
  sessionsDir: string;
  agentId: string;
}

export function buildFilePathClassifierContext(cfg: Config, sessionKeyRaw?: string): FilePathClassifierContext {
  const agentId = extractProfileAgentId(sessionKeyRaw, cfg);
  const stateDir = resolveStateDir();
  return {
    workspaceRoot: '',
    profileMarkdownRoot: resolveAgentProfileDir(cfg, agentId),
    stateDir,
    skillsDir: resolveSkillsDir(),
    configFilePath: resolveConfigPath(),
    agentsHomeDir: resolve(stateDir, 'agents'),
    sessionsDir: resolveSessionsDir(cfg, agentId),
    agentId,
  };
}

export function looksLikeHostAbsolutePath(pathRaw: string): boolean {
  const p = pathRaw.trim();
  if (!p) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(p) && !/^[A-Za-z]:[\\/]/.test(p)) return false;
  return isAbsolute(p) || /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\');
}

export function fileRefSessionKeysMatch(registered?: string, query?: string): boolean {
  return (registered ?? '').trim() === (query ?? '').trim();
}

export interface ClassifiedFileLocation {
  scope: FileReferenceScope;
  locationKind?: FileReferenceLocationKind;
  manageRoute?: string;
}

export function classifyFileLocation(absPath: string, ctx: FilePathClassifierContext): ClassifiedFileLocation {
  const p = resolve(absPath);
  const workspaceRoot = resolve(ctx.workspaceRoot);

  if (isPathUnderWorkspace(workspaceRoot, p)) {
    return { scope: 'workspace' };
  }

  if (ctx.profileMarkdownRoot) {
    const profileRoot = resolve(ctx.profileMarkdownRoot);
    if (isPathUnderWorkspace(profileRoot, p)) {
      return {
        scope: 'agent-profile',
        locationKind: 'agent-profile',
        manageRoute: '/settings/agents',
      };
    }
  }

  const skillsRoot = resolve(ctx.skillsDir);
  if (isPathUnderWorkspace(skillsRoot, p)) {
    return {
      scope: 'external',
      locationKind: 'xopc-skills',
      manageRoute: '/settings/skills',
    };
  }

  const sessionsRoot = resolve(ctx.sessionsDir);
  if (isPathUnderWorkspace(sessionsRoot, p)) {
    return {
      scope: 'session-artifact',
      locationKind: 'xopc-sessions',
      manageRoute: '/settings/sessions',
    };
  }

  const agentsRoot = resolve(ctx.agentsHomeDir);
  if (isPathUnderWorkspace(agentsRoot, p)) {
    return {
      scope: 'external',
      locationKind: 'xopc-agents',
      manageRoute: '/settings/agents',
    };
  }

  const stateRoot = resolve(ctx.stateDir);
  const configPath = resolve(ctx.configFilePath);
  if (p === configPath || isPathUnderWorkspace(stateRoot, p)) {
    return {
      scope: 'external',
      locationKind: 'xopc-config',
      manageRoute: '/settings/gateway',
    };
  }

  return { scope: 'external', locationKind: 'host' };
}

export interface ResolveFileReferenceCandidateResult {
  candidate: string | null;
  invalid: boolean;
}

/**
 * Resolve user path to an absolute candidate (workspace, absolute host, or profile fallback).
 */
export async function resolveFileReferenceCandidate(
  rawPath: string,
  workspaceRoot: string,
  ctx: FilePathClassifierContext,
): Promise<ResolveFileReferenceCandidateResult> {
  const displayRoot = workspaceRoot;
  ctx = { ...ctx, workspaceRoot: displayRoot };

  if (looksLikeHostAbsolutePath(rawPath)) {
    return { candidate: resolve(rawPath), invalid: false };
  }

  const wsPath = resolveWorkspaceSafePath(workspaceRoot, rawPath);
  if (!wsPath) {
    return { candidate: null, invalid: true };
  }

  try {
    await stat(wsPath);
    return { candidate: wsPath, invalid: false };
  } catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT' && ctx.profileMarkdownRoot && isBareProfileMarkdownFileName(rawPath)) {
      const alt = resolveProfileMarkdownPathIfBareName(rawPath, ctx.profileMarkdownRoot);
      return { candidate: alt, invalid: false };
    }
    return { candidate: wsPath, invalid: false };
  }
}

export function displayNameForPath(rawPath: string): string {
  return basename(rawPath.replace(/\\/g, '/')) || rawPath;
}

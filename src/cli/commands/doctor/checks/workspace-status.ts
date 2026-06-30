import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { resolveDefaultAgentId, resolveAgentProfileDir, resolveAgentWorkspaceDir } from '../../../../agent/agent-scope.js';
import { loadConfig } from '../../../../config/loader.js';
import { WORKSPACE_FILES } from '../../../../config/paths.js';
import type { CheckResult, DoctorContext } from '../types.js';

export async function checkWorkspaceStatus(ctx: DoctorContext): Promise<CheckResult> {
  if (!existsSync(ctx.configPath)) {
    return {
      id: 'workspace-status',
      label: 'Workspace',
      status: 'skip',
      message: 'No config file; skipped.',
      hints: [],
    };
  }

  let config;
  try {
    config = loadConfig(ctx.configPath);
  } catch {
    return {
      id: 'workspace-status',
      label: 'Workspace',
      status: 'skip',
      message: 'Config could not be loaded; skipped.',
      hints: [],
    };
  }

  const agentId = resolveDefaultAgentId(config);
  const root = resolveAgentWorkspaceDir(config, agentId);
  const profileRoot = resolveAgentProfileDir(config, agentId);
  const hints: string[] = [];

  const hasProfileFile = (name: string): boolean => existsSync(join(profileRoot, name));

  if (!existsSync(root)) {
    return {
      id: 'workspace-status',
      label: 'Workspace',
      status: 'warn',
      message: 'Agent workspace directory is missing.',
      hints: [root, 'Run: xopc init or xopc onboard'],
    };
  }

  if (!existsSync(profileRoot)) {
    return {
      id: 'workspace-status',
      label: 'Workspace',
      status: 'warn',
      message: 'Agent profile directory is missing.',
      hints: [profileRoot, 'Run: xopc init or xopc onboard'],
    };
  }

  const missing: string[] = [];
  if (!hasProfileFile(WORKSPACE_FILES.SOUL)) missing.push(WORKSPACE_FILES.SOUL);
  if (!hasProfileFile(WORKSPACE_FILES.IDENTITY)) missing.push(WORKSPACE_FILES.IDENTITY);

  if (missing.length > 0) {
    return {
      id: 'workspace-status',
      label: 'Workspace',
      status: 'warn',
      message: `Essential profile files missing: ${missing.join(', ')}.`,
      hints: [profileRoot, root, 'Run: xopc init or xopc onboard'],
    };
  }

  if (!hasProfileFile(WORKSPACE_FILES.TOOLS)) {
    hints.push(`${WORKSPACE_FILES.TOOLS} is optional; add tool notes if you use many tools.`);
  }

  if (!existsSync(join(root, '.git'))) {
    hints.push('No .git in workspace; version control is recommended for backup and history.');
  }

  if (hints.length > 0) {
    return {
      id: 'workspace-status',
      label: 'Workspace',
      status: 'pass',
      message: 'Markdown workspace and essential profile files are present.',
      hints,
    };
  }

  return {
    id: 'workspace-status',
    label: 'Workspace',
    status: 'pass',
      message: 'Markdown workspace and essential profile files look good.',
      hints: [profileRoot, root],
  };
}

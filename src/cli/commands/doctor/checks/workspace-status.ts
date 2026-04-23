import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { resolveDefaultAgentId, resolveAgentWorkspaceDir } from '../../../../agent/agent-scope.js';
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
  const hints: string[] = [];

  if (!existsSync(root)) {
    return {
      id: 'workspace-status',
      label: 'Workspace',
      status: 'warn',
      message: 'Agent workspace directory is missing.',
      hints: [root, 'Run: xopc onboard'],
    };
  }

  const soul = join(root, WORKSPACE_FILES.SOUL);
  const identity = join(root, WORKSPACE_FILES.IDENTITY);
  const missing: string[] = [];
  if (!existsSync(soul)) missing.push(WORKSPACE_FILES.SOUL);
  if (!existsSync(identity)) missing.push(WORKSPACE_FILES.IDENTITY);

  if (missing.length > 0) {
    return {
      id: 'workspace-status',
      label: 'Workspace',
      status: 'warn',
      message: `Essential workspace files missing: ${missing.join(', ')}.`,
      hints: [root, 'Run: xopc onboard'],
    };
  }

  if (!existsSync(join(root, WORKSPACE_FILES.USER))) {
    hints.push(`${WORKSPACE_FILES.USER} is optional; add a user profile for better context.`);
  }
  if (!existsSync(join(root, WORKSPACE_FILES.TOOLS))) {
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
      message: 'Essential workspace files are present.',
      hints,
    };
  }

  return {
    id: 'workspace-status',
    label: 'Workspace',
    status: 'pass',
    message: 'Workspace directory and essential files look good.',
    hints: [root],
  };
}

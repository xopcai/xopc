import { sanitizeForPromptLiteral } from '../sanitize-for-prompt.js';

export type RuntimeInfoInput = {
  version?: string;
  model?: string;
  channel?: string;
  agentId?: string;
  thinkingLevel?: string;
  capabilities?: string[];
};

export function buildWorkspaceSection(workspaceDir: string): string {
  const sanitized = sanitizeForPromptLiteral(workspaceDir);
  return [
    '## Workspace',
    `Your working directory is: ${sanitized}`,
    'Treat this directory as the single global workspace for file operations unless explicitly instructed otherwise.',
  ].join('\n');
}

export function buildWorkspaceFilesIntroSection(): string {
  return [
    '## Workspace Files (injected)',
    '',
    'Profile bootstrap files are injected below as Project Context. Do not manually reread them at session start unless the user asks or injected content is insufficient.',
  ].join('\n');
}

export function buildRuntimeSection(runtime?: RuntimeInfoInput): string {
  if (!runtime) {
    return '';
  }
  const parts: string[] = [];
  if (runtime.agentId) parts.push(`agent=${runtime.agentId}`);
  if (runtime.version) parts.push(`v${runtime.version}`);
  if (runtime.model) parts.push(`model=${runtime.model.split('/').pop() ?? runtime.model}`);
  if (runtime.channel) parts.push(`channel=${runtime.channel}`);
  if (runtime.capabilities && runtime.capabilities.length > 0) {
    parts.push(`capabilities=${runtime.capabilities.join(',')}`);
  }
  if (runtime.thinkingLevel) parts.push(`thinking=${runtime.thinkingLevel}`);
  if (parts.length === 0) {
    return '';
  }
  return ['## Runtime', `Runtime: ${parts.join(' | ')}`].join('\n');
}

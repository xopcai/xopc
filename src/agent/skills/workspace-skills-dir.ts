import { join } from 'node:path';

const PROJECT_XOPC_DIR = '.xopc';
const PROJECT_SKILLS_DIR = 'skills';

export function resolveWorkspaceSkillsDir(workspaceDir: string): string {
  return join(workspaceDir, PROJECT_XOPC_DIR, PROJECT_SKILLS_DIR);
}

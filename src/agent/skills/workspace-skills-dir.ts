import { join } from 'node:path';

const PROJECT_XOPC_DIR = '.xopc';
const PROJECT_SKILLS_DIR = 'skills';
const PROJECT_SKILLS_LOCK = 'skills-lock.json';

export function resolveWorkspaceSkillsDir(workspaceDir: string): string {
  return join(workspaceDir, PROJECT_XOPC_DIR, PROJECT_SKILLS_DIR);
}

export function resolveWorkspaceSkillsLockPath(workspaceDir: string): string {
  return join(workspaceDir, PROJECT_XOPC_DIR, PROJECT_SKILLS_LOCK);
}

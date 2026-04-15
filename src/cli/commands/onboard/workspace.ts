/**
 * Workspace Setup for Onboarding
 *
 * Mirrors `src/cli/utils/workspace.ts`: workspace root + memory/ only.
 * Bootstrap Markdown is seeded via seedMainAgentBootstrap.
 */

import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';

/**
 * Check if workspace directory exists
 */
export function isWorkspaceSetup(workspacePath: string): boolean {
  return existsSync(workspacePath);
}

/**
 * Create markdown workspace root and memory/ only
 */
export function setupWorkspace(workspacePath: string): void {
  if (!existsSync(workspacePath)) {
    mkdirSync(workspacePath, { recursive: true });
    console.log('✅ Created workspace:', workspacePath);
  } else {
    console.log('ℹ️  Workspace already exists:', workspacePath);
  }

  const memoryDir = join(workspacePath, 'memory');
  if (!existsSync(memoryDir)) {
    mkdirSync(memoryDir, { recursive: true });
    console.log('✅ Created memory/ directory');
  }
}

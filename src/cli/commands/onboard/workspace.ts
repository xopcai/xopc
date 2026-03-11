/**
 * Workspace Setup for Onboarding
 */

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getFallbackTemplate, TEMPLATE_FILES } from '../../templates.js';

/**
 * Check if workspace is properly set up
 */
export function isWorkspaceSetup(workspacePath: string): boolean {
  return existsSync(workspacePath) && existsSync(join(workspacePath, 'AGENTS.md'));
}

/**
 * Setup workspace directory and bootstrap files
 */
export function setupWorkspace(workspacePath: string): void {
  if (!existsSync(workspacePath)) {
    mkdirSync(workspacePath, { recursive: true });
    console.log('✅ Created workspace:', workspacePath);
  } else {
    console.log('ℹ️  Workspace already exists:', workspacePath);
  }

  // Use built-in templates (no frontmatter)
  const memoryDir = join(workspacePath, 'memory');
  if (!existsSync(memoryDir)) {
    mkdirSync(memoryDir, { recursive: true });
    console.log('✅ Created memory/ directory');
  }

  for (const filename of TEMPLATE_FILES) {
    const filePath = join(workspacePath, filename);
    if (!existsSync(filePath)) {
      const content = getFallbackTemplate(filename);
      writeFileSync(filePath, content, 'utf-8');
      console.log('✅ Created', filename);
    }
  }
}

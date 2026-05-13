/**
 * Workspace utilities - shared between setup and onboard commands
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

export interface WorkspaceStatus {
  configExists: boolean;
  workspaceExists: boolean;
  workspaceSetup: boolean;
  configPath: string;
  workspacePath: string;
}

/**
 * Check if workspace directory exists (markdown root + memory/ are created by setupWorkspace).
 */
export function isWorkspaceSetup(workspacePath: string): boolean {
  return existsSync(workspacePath);
}

/**
 * Check if config file exists
 */
export function isConfigSetup(configPath: string): boolean {
  return existsSync(configPath);
}

/**
 * Get current workspace status
 */
export function getWorkspaceStatus(configPath: string, workspacePath: string): WorkspaceStatus {
  return {
    configExists: isConfigSetup(configPath),
    workspaceExists: existsSync(workspacePath),
    workspaceSetup: isWorkspaceSetup(workspacePath),
    configPath,
    workspacePath,
  };
}

/**
 * Create markdown workspace root and memory/ only.
 * Persona Markdown is seeded into the Markdown workspace root via seedMainAgentProfileMarkdown.
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

/**
 * Create empty config file
 */
export function setupConfig(configPath: string): void {
  const configDir = join(configPath, '..');
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }

  if (!existsSync(configPath)) {
    writeFileSync(configPath, '{}\n', 'utf-8');
    console.log('✅ Created config:', configPath);
  } else {
    console.log('ℹ️  Config already exists:', configPath);
  }
}

/**
 * Load raw config without schema parsing
 */
export function loadRawConfig(configPath: string): Record<string, unknown> | null {
  if (!existsSync(configPath)) {
    return null;
  }
  try {
    const content = readFileSync(configPath, 'utf-8');
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }
}

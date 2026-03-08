/**
 * Workspace utilities - shared between setup and onboard commands
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import type { TemplateFile } from '../templates.js';
import { loadAllTemplates, TEMPLATE_FILES } from '../templates.js';

export interface WorkspaceStatus {
  configExists: boolean;
  workspaceExists: boolean;
  workspaceSetup: boolean;
  configPath: string;
  workspacePath: string;
}

/**
 * Check if workspace is properly set up
 */
export function isWorkspaceSetup(workspacePath: string): boolean {
  return existsSync(workspacePath) && existsSync(join(workspacePath, 'AGENTS.md'));
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
 * Setup workspace directory and bootstrap files
 */
export function setupWorkspace(workspacePath: string): void {
  if (!existsSync(workspacePath)) {
    mkdirSync(workspacePath, { recursive: true });
    console.log('✅ Created workspace:', workspacePath);
  } else {
    console.log('ℹ️  Workspace already exists:', workspacePath);
  }

  // Load templates
  const templates = loadAllTemplates();

  const memoryDir = join(workspacePath, 'memory');
  if (!existsSync(memoryDir)) {
    mkdirSync(memoryDir, { recursive: true });
    console.log('✅ Created memory/ directory');
  }

  for (const filename of TEMPLATE_FILES) {
    const filePath = join(workspacePath, filename);
    if (!existsSync(filePath)) {
      writeFileSync(filePath, templates[filename], 'utf-8');
      console.log('✅ Created', filename);
    } else {
      console.log('ℹ️ ', filename, 'already exists (skipped)');
    }
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
 * Quick setup (non-interactive) - creates minimal files if missing
 */
export function quickSetup(workspacePath: string): void {
  // Ensure workspace dir exists
  if (!existsSync(workspacePath)) {
    mkdirSync(workspacePath, { recursive: true });
  }

  // Ensure memory dir exists
  const memoryDir = join(workspacePath, 'memory');
  if (!existsSync(memoryDir)) {
    mkdirSync(memoryDir, { recursive: true });
  }

  // Create minimal templates
  const minimalTemplates: Record<TemplateFile, string> = {
    'BOOTSTRAP.md': '# BOOTSTRAP.md\n\nHello! Delete this when done.\n',
    'AGENTS.md': '# AGENTS.md\n\nYour workspace.\n',
    'SOUL.md': '# SOUL.md\n\nWho you are.\n',
    'IDENTITY.md': '# IDENTITY.md\n\n- Name:\n- Emoji:\n',
    'USER.md': '# USER.md\n\nAbout your human.\n',
    'TOOLS.md': '# TOOLS.md\n\nLocal notes.\n',
    'HEARTBEAT.md': '# HEARTBEAT.md\n\nPeriodic checks.\n',
    'MEMORY.md': '# MEMORY.md\n\nLong-term memory.\n',
  };

  for (const [filename, content] of Object.entries(minimalTemplates)) {
    const filePath = join(workspacePath, filename as TemplateFile);
    if (!existsSync(filePath)) {
      writeFileSync(filePath, content, 'utf-8');
    }
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

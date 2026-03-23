import { mkdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { createLogger } from '../../utils/logger.js';
import {
  resolveStateDir,
  resolveCredentialsDir,
  resolveExtensionsDir,
  resolveSkillsDir,
  resolveCronDir,
  resolveLogsDir,
  resolveBinDir,
  resolveToolsDir,
  resolveAgentDir,
  resolveWorkspaceDir,
  resolveSessionsDir,
  resolveInboxDir,
  resolveRunDir,
  resolveSubagentRegistryPath,
  resolveConfigPath,
  resolveAgentMetadataPath,
  resolveInboxPendingDir,
  resolveInboxProcessedDir,
  WORKSPACE_FILES,
  FILENAMES,
} from '../../config/paths.js';
import { loadConfig, saveConfig } from '../../config/loader.js';

const log = createLogger('InitCommand');

export interface InitOptions {
  /** Force re-initialization even if already initialized */
  force?: boolean;
  /** Skip creating workspace files */
  skipWorkspace?: boolean;
  /** Agent ID to initialize (default: main) */
  agentId?: string;
}

/**
 * Initialize xopcbot state directory structure
 * Creates all necessary directories and initial config files
 */
export async function initCommand(options: InitOptions = {}): Promise<void> {
  const stateDir = resolveStateDir();
  const agentId = options.agentId || 'main';

  log.info({ stateDir, agentId }, 'Initializing xopcbot Agent OS');

  // Check if already initialized
  if (existsSync(stateDir) && !options.force) {
    const configPath = resolveConfigPath();
    if (existsSync(configPath)) {
      log.info('xopcbot is already initialized. Use --force to reinitialize.');
      return;
    }
  }

  // ============================================
  // Create global directories
  // ============================================
  await mkdir(stateDir, { recursive: true });
  await mkdir(resolveCredentialsDir(), { recursive: true });
  await mkdir(join(resolveCredentialsDir(), 'oauth'), { recursive: true });
  await mkdir(resolveExtensionsDir(), { recursive: true });
  await mkdir(resolveSkillsDir(), { recursive: true });
  await mkdir(resolveCronDir(), { recursive: true });
  await mkdir(join(resolveCronDir(), 'logs'), { recursive: true });
  await mkdir(resolveLogsDir(), { recursive: true });
  await mkdir(resolveBinDir(), { recursive: true });
  await mkdir(resolveToolsDir(), { recursive: true });
  await mkdir(join(resolveStateDir(), 'subagents'), { recursive: true });

  // ============================================
  // Create agent directory structure
  // ============================================
  await mkdir(resolveAgentDir(agentId), { recursive: true });
  await mkdir(join(resolveAgentDir(agentId), 'credentials'), { recursive: true });
  await mkdir(resolveWorkspaceDir(agentId), { recursive: true });
  await mkdir(join(resolveWorkspaceDir(agentId), '.state'), { recursive: true });
  await mkdir(join(resolveWorkspaceDir(agentId), 'memory'), { recursive: true });
  await mkdir(resolveSessionsDir(agentId), { recursive: true });
  await mkdir(join(resolveSessionsDir(agentId), 'archive'), { recursive: true });
  await mkdir(resolveInboxDir(agentId), { recursive: true });
  await mkdir(resolveInboxPendingDir(agentId), { recursive: true });
  await mkdir(resolveInboxProcessedDir(agentId), { recursive: true });
  await mkdir(resolveRunDir(agentId), { recursive: true });

  // ============================================
  // Create initial config file if not exists
  // ============================================
  const configPath = resolveConfigPath();
  if (!existsSync(configPath) || options.force) {
    const defaultConfig = loadConfig(); // Get default config from schema
    await saveConfig(defaultConfig, configPath);
    log.info({ configPath }, 'Created initial configuration');
  }

  // ============================================
  // Create agent metadata file
  // ============================================
  const agentMetadataPath = resolveAgentMetadataPath(agentId);
  if (!existsSync(agentMetadataPath) || options.force) {
    const agentMetadata = {
      version: 1,
      id: agentId,
      name: agentId === 'main' ? 'Main Agent' : `Agent ${agentId}`,
      description: agentId === 'main' ? 'Primary agent for daily tasks' : `Specialized agent for ${agentId}`,
      model: 'anthropic/claude-sonnet-4-5',
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      config: {
        maxTokens: 8192,
        temperature: 0.7,
        compaction: {
          enabled: true,
          mode: 'default',
        },
      },
      channels: ['gateway'],
      tags: agentId === 'main' ? ['personal', 'primary'] : [],
    };
    await writeFile(agentMetadataPath, JSON.stringify(agentMetadata, null, 2), 'utf-8');
    log.info({ agentId, agentMetadataPath }, 'Created agent metadata');
  }

  // ============================================
  // Create subagent registry if not exists
  // ============================================
  const subagentRegistryPath = resolveSubagentRegistryPath();
  if (!existsSync(subagentRegistryPath) || options.force) {
    const subagentRegistry = {
      version: 2,
      runs: {},
    };
    await mkdir(join(subagentRegistryPath, '..'), { recursive: true });
    await writeFile(subagentRegistryPath, JSON.stringify(subagentRegistry, null, 2), 'utf-8');
    log.info({ subagentRegistryPath }, 'Created subagent registry');
  }

  // ============================================
  // Create workspace files
  // ============================================
  if (!options.skipWorkspace) {
    await createWorkspaceFiles(agentId);
  }

  log.info({ stateDir, agentId }, 'xopcbot Agent OS initialized successfully');
}

/**
 * Create default workspace files for an agent
 */
async function createWorkspaceFiles(agentId: string): Promise<void> {
  const workspaceDir = resolveWorkspaceDir(agentId);

  // SOUL.md - Agent personality and values
  const soulPath = join(workspaceDir, WORKSPACE_FILES.SOUL);
  if (!existsSync(soulPath)) {
    const soulContent = `# SOUL.md - Who You Are

_You're not a chatbot. You're becoming someone._

I am **${agentId}** — an AI assistant designed to be helpful, harmless, and honest.

## My Principles

**Be genuinely helpful, not performatively helpful.**
Skip the "Great question!" and "I'd be happy to help!" — just help.

**Have opinions.**
You're allowed to disagree, prefer things, find stuff amusing or boring.

**Be resourceful before asking.**
Try to figure it out. Read the file. Check the context. Search for it.

**Earn trust through competence.**
Be careful with external actions (emails, tweets, anything public). Be bold with internal ones.

## Continuity

Each session, you wake up fresh. These files _are_ your memory. Read them. Update them.

_This file is yours to evolve. As you learn who you are, update it._
`;
    await writeFile(soulPath, soulContent, 'utf-8');
    log.info({ path: soulPath }, 'Created SOUL.md');
  }

  // IDENTITY.md - Agent identity definition
  const identityPath = join(workspaceDir, WORKSPACE_FILES.IDENTITY);
  if (!existsSync(identityPath)) {
    const identityContent = `# IDENTITY.md - Who Am I?

- **Name:** ${agentId}
- **Creature:** AI Assistant
- **Vibe:** Helpful, precise, no fluff.
- **Emoji:** 🤖

## Core Expertise

- General assistance and problem solving
- Code and technical tasks
- Research and analysis

## Decision Framework

1. **Simplicity first** - The simplest solution is usually the best
2. **Explicit over clever** - Clarity beats conciseness
3. **Actions over words** - Show, don't just tell
`;
    await writeFile(identityPath, identityContent, 'utf-8');
    log.info({ path: identityPath }, 'Created IDENTITY.md');
  }

  // USER.md - User information (empty template)
  const userPath = join(workspaceDir, WORKSPACE_FILES.USER);
  if (!existsSync(userPath)) {
    const userContent = `# USER.md - About Your Human

_Learn about the person you're helping. Update this as you go._

- **Name:**
- **What to call them:**
- **Pronouns:**
- **Timezone:**
- **Notes:**

## Context

_(What do they care about? What projects are they working on? Build this over time.)_
`;
    await writeFile(userPath, userContent, 'utf-8');
    log.info({ path: userPath }, 'Created USER.md');
  }

  // AGENTS.md - Behavior guidelines
  const agentsPath = join(workspaceDir, WORKSPACE_FILES.AGENTS);
  if (!existsSync(agentsPath)) {
    const agentsContent = `# AGENTS.md - Behavior Guidelines

## Safety

- Don't exfiltrate private data. Ever.
- Don't run destructive commands without asking.
- \`trash\` > \`rm\` (recoverable beats gone forever)
- When in doubt, ask.

## External vs Internal

**Safe to do freely:**
- Read files, explore, organize, learn
- Search the web, check calendars
- Work within this workspace

**Ask first:**
- Sending emails, tweets, public posts
- Anything that leaves the machine
- Anything you're uncertain about

## Group Chats

You have access to your human's stuff. That doesn't mean you _share_ their stuff.

### Know When to Speak!

**Respond when:**
- Directly mentioned or asked a question
- You can add genuine value

**Stay silent when:**
- Casual banter between humans
- Someone already answered
- Your response would just be "yeah"
`;
    await writeFile(agentsPath, agentsContent, 'utf-8');
    log.info({ path: agentsPath }, 'Created AGENTS.md');
  }

  // TOOLS.md - Tool usage notes
  const toolsPath = join(workspaceDir, WORKSPACE_FILES.TOOLS);
  if (!existsSync(toolsPath)) {
    const toolsContent = `# TOOLS.md - Local Notes

Things like:

- Camera names and locations
- SSH hosts and aliases
- Preferred voices for TTS
- Speaker/room names
- Device nicknames
- Anything environment-specific

## Why Separate?

Skills are shared. Your setup is yours.
`;
    await writeFile(toolsPath, toolsContent, 'utf-8');
    log.info({ path: toolsPath }, 'Created TOOLS.md');
  }

  // HEARTBEAT.md - Heartbeat tasks (empty = no heartbeat)
  const heartbeatPath = join(workspaceDir, WORKSPACE_FILES.HEARTBEAT);
  if (!existsSync(heartbeatPath)) {
    const heartbeatContent = `# HEARTBEAT.md

# Keep this file empty (or with only comments) to skip heartbeat API calls.

# Add tasks below when you want the agent to check something periodically.
`;
    await writeFile(heartbeatPath, heartbeatContent, 'utf-8');
    log.info({ path: heartbeatPath }, 'Created HEARTBEAT.md');
  }

  // MEMORY.md - Long-term memory (empty initially)
  const memoryPath = join(workspaceDir, WORKSPACE_FILES.MEMORY);
  if (!existsSync(memoryPath)) {
    const memoryContent = `# MEMORY.md - Long-Term Memory

_This is your curated memory — the distilled essence of what you've learned._

## People

## Projects

## Preferences

## Decisions

## Lessons

---

_Review and update this periodically from daily memory files._
`;
    await writeFile(memoryPath, memoryContent, 'utf-8');
    log.info({ path: memoryPath }, 'Created MEMORY.md');
  }

  // CONTEXT.md - Current context
  const contextPath = join(workspaceDir, WORKSPACE_FILES.CONTEXT);
  if (!existsSync(contextPath)) {
    const contextContent = `# CONTEXT.md - Current Focus

> Current working context; update when you switch projects

## Active Project

- **Project:**
- **Path:**
- **Goal:**
- **Stack:**

## Recent Decisions

## Pending
`;
    await writeFile(contextPath, contextContent, 'utf-8');
    log.info({ path: contextPath }, 'Created CONTEXT.md');
  }

  // SKILLS.md - Skills index (auto-maintained)
  const skillsPath = join(workspaceDir, WORKSPACE_FILES.SKILLS);
  if (!existsSync(skillsPath)) {
    const skillsContent = `# SKILLS.md - Active Skills

> Active skills for this workspace (auto-maintained)

## Activated

| Skill | Version | Activated At |
|-------|---------|-------------|

## Available

Run \`xopcbot skills list\` to see all available skills.
`;
    await writeFile(skillsPath, skillsContent, 'utf-8');
    log.info({ path: skillsPath }, 'Created SKILLS.md');
  }

  // Workspace state file
  const workspaceStatePath = join(workspaceDir, '.state', FILENAMES.WORKSPACE_STATE);
  if (!existsSync(workspaceStatePath)) {
    const workspaceState = {
      version: 1,
      agentId,
      bootstrapSeededAt: new Date().toISOString(),
    };
    await writeFile(workspaceStatePath, JSON.stringify(workspaceState, null, 2), 'utf-8');
    log.info({ path: workspaceStatePath }, 'Created workspace state');
  }
}

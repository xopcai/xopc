import { mkdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { createLogger } from '../../utils/logger.js';
import {
  resolveStateDir,
  resolveAgentDir,
  resolveAgentWorkspaceDir,
  resolveConfigPath,
  resolveAgentHomeDir,
  resolveAgentProfileDir,
  resolveUserProfilePath,
  WORKSPACE_FILES,
} from '../../config/paths.js';
import { loadConfig, saveConfig } from '../../config/loader.js';
import type { Config } from '../../config/schema.js';

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
 * Initialize xopc state directory structure
 * Creates all necessary directories and initial config files
 */
export async function initCommand(options: InitOptions = {}): Promise<void> {
  const stateDir = resolveStateDir();
  const agentId = options.agentId || 'main';

  log.info({ stateDir, agentId }, 'Initializing xopc Agent OS');

  // Check if already initialized
  if (existsSync(stateDir) && !options.force) {
    const configPath = resolveConfigPath();
    if (existsSync(configPath)) {
      log.info('xopc is already initialized. Use --force to reinitialize.');
      return;
    }
  }

  await mkdir(stateDir, { recursive: true });

  const configPath = resolveConfigPath();
  const cfg = loadConfig(configPath);

  // Agent directory structure
  await mkdir(resolveAgentHomeDir(cfg, agentId), { recursive: true });
  await mkdir(resolveAgentProfileDir(cfg, agentId), { recursive: true });
  await mkdir(resolveAgentDir(cfg, agentId), { recursive: true });
  const wsRoot = resolveAgentWorkspaceDir(cfg, agentId);
  await mkdir(wsRoot, { recursive: true });

  // Config file
  if (!existsSync(configPath) || options.force) {
    await saveConfig(cfg, configPath);
    log.info({ configPath }, 'Created initial configuration');
  }

  // ============================================
  // Create workspace files
  // ============================================
  if (!options.skipWorkspace) {
    await createWorkspaceFiles(cfg, agentId);
  }

  log.info({ stateDir, agentId }, 'xopc Agent OS initialized successfully');
}

/**
 * Create default workspace files for an agent
 */
async function createWorkspaceFiles(cfg: Config, agentId: string): Promise<void> {
  const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);
  const profileDir = resolveAgentProfileDir(cfg, agentId);
  await mkdir(workspaceDir, { recursive: true });
  await mkdir(profileDir, { recursive: true });

  // SOUL.md - Agent personality and values
  const soulPath = join(profileDir, WORKSPACE_FILES.SOUL);
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
  const identityPath = join(profileDir, WORKSPACE_FILES.IDENTITY);
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

  // Global user profile (shared by all agents)
  const userPath = resolveUserProfilePath();
  if (!existsSync(userPath)) {
    await mkdir(dirname(userPath), { recursive: true });
    const userContent = `# PROFILE.md - About You

_Shared by all agents. Update this as your preferences and context change._

- **Name:**
- **What to call them:**
- **Pronouns:**
- **Timezone:**
- **Notes:**

## Context

_(What do they care about? What projects are they working on? Build this over time.)_
`;
    await writeFile(userPath, userContent, 'utf-8');
    log.info({ path: userPath }, 'Created global user PROFILE.md');
  }

  // AGENTS.md - Behavior guidelines
  const agentsPath = join(profileDir, WORKSPACE_FILES.AGENTS);
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
  const toolsPath = join(profileDir, WORKSPACE_FILES.TOOLS);
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
  const heartbeatPath = join(profileDir, WORKSPACE_FILES.HEARTBEAT);
  if (!existsSync(heartbeatPath)) {
    const heartbeatContent = `# HEARTBEAT.md

# Keep this file empty (or with only comments) to skip heartbeat API calls.

# Add tasks below when you want the agent to check something periodically.
`;
    await writeFile(heartbeatPath, heartbeatContent, 'utf-8');
    log.info({ path: heartbeatPath }, 'Created HEARTBEAT.md');
  }

  // MEMORY.md - Long-term memory (empty initially)
  const memoryPath = join(profileDir, WORKSPACE_FILES.MEMORY);
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
}

// ─── CLI registration ───

import { Command } from 'commander';
import { register, formatExamples, type CLIContext } from '../registry.js';

function createInitCommand(_ctx: CLIContext): Command {
  return new Command('init')
    .description('Initialize xopc state directories, config, and agent workspace')
    .addHelpText(
      'after',
      formatExamples([
        'xopc init                       # Initialize default agent (main)',
        'xopc init --agent-id coder      # Initialize another agent id',
        'xopc init --force               # Re-run initialization steps',
        'xopc setup                      # Lighter config + workspace only',
      ]),
    )
    .option('--force', 'Re-initialize even if directories already exist')
    .option('--skip-workspace', 'Skip creating workspace profile files')
    .option('--agent-id <id>', 'Agent id to initialize', 'main')
    .action(async (options) => {
      await initCommand({
        force: options.force,
        skipWorkspace: options.skipWorkspace,
        agentId: options.agentId,
      });
      console.log(`✅ xopc initialized (agent: ${options.agentId})`);
    });
}

register({
  id: 'init',
  name: 'init',
  description: 'Initialize xopc state directories, config, and agent workspace',
  factory: createInitCommand,
  metadata: {
    category: 'setup',
    examples: ['xopc init', 'xopc init --agent-id main'],
  },
});

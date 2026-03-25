/**
 * Workspace Management - Core bootstrap file handling
 * 
 * Workspace architecture for xopcbot:
 * - Default filenames constants
 * - File caching with mtime invalidation
 * - Template loading and seeding
 * - Bootstrap file loading with filtering
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { createLogger } from '../../utils/logger.js';
import { parseFrontmatter } from '../../markdown/frontmatter.js';

const log = createLogger('Workspace');

// =============================================================================
// Default Filenames
// =============================================================================

export const DEFAULT_AGENTS_FILENAME = 'AGENTS.md';
export const DEFAULT_SOUL_FILENAME = 'SOUL.md';
export const DEFAULT_TOOLS_FILENAME = 'TOOLS.md';
export const DEFAULT_IDENTITY_FILENAME = 'IDENTITY.md';
export const DEFAULT_USER_FILENAME = 'USER.md';
export const DEFAULT_HEARTBEAT_FILENAME = 'HEARTBEAT.md';
export const DEFAULT_BOOTSTRAP_FILENAME = 'BOOTSTRAP.md';
export const DEFAULT_MEMORY_FILENAME = 'MEMORY.md';
export const DEFAULT_MEMORY_ALT_FILENAME = 'memory.md';
export const DEFAULT_WORKSPACE_STATE_DIR = '.xopcbot';
export const DEFAULT_WORKSPACE_STATE_FILE = 'workspace-state.json';

// =============================================================================
// Types
// =============================================================================

export type WorkspaceBootstrapFileName =
  | typeof DEFAULT_AGENTS_FILENAME
  | typeof DEFAULT_SOUL_FILENAME
  | typeof DEFAULT_TOOLS_FILENAME
  | typeof DEFAULT_IDENTITY_FILENAME
  | typeof DEFAULT_USER_FILENAME
  | typeof DEFAULT_HEARTBEAT_FILENAME
  | typeof DEFAULT_BOOTSTRAP_FILENAME
  | typeof DEFAULT_MEMORY_FILENAME
  | typeof DEFAULT_MEMORY_ALT_FILENAME;

export interface WorkspaceBootstrapFile {
  name: WorkspaceBootstrapFileName;
  path: string;
  content?: string;
  missing: boolean;
}

export interface WorkspaceBootstrapOptions {
  ensureBootstrapFiles?: boolean;
  templateDir?: string;
}

// Workspace onboarding state
export interface WorkspaceOnboardingState {
  version: number;
  bootstrapSeededAt?: string;
  onboardingCompletedAt?: string;
}

// =============================================================================
// Valid Bootstrap Names (for runtime validation)
// =============================================================================

const VALID_BOOTSTRAP_NAMES: ReadonlySet<string> = new Set([
  DEFAULT_AGENTS_FILENAME,
  DEFAULT_SOUL_FILENAME,
  DEFAULT_TOOLS_FILENAME,
  DEFAULT_IDENTITY_FILENAME,
  DEFAULT_USER_FILENAME,
  DEFAULT_HEARTBEAT_FILENAME,
  DEFAULT_BOOTSTRAP_FILENAME,
  DEFAULT_MEMORY_FILENAME,
  DEFAULT_MEMORY_ALT_FILENAME,
]);

export function isValidBootstrapFileName(name: string): boolean {
  return VALID_BOOTSTRAP_NAMES.has(name);
}

// =============================================================================
// File Content Cache with mtime Invalidation
// =============================================================================

interface CacheEntry {
  content: string;
  mtimeMs: number;
}

const workspaceFileCache = new Map<string, CacheEntry>();

/**
 * Read file with caching based on mtime. Returns cached content if file
 * hasn't changed, otherwise reads from disk and updates cache.
 * 
 * Performance optimization approach.
 */
export async function readFileWithCache(filePath: string): Promise<string> {
  try {
    const stats = await fs.stat(filePath);
    const mtimeMs = stats.mtimeMs;
    const cached = workspaceFileCache.get(filePath);

    // Return cached content if mtime matches
    if (cached && cached.mtimeMs === mtimeMs) {
      return cached.content;
    }

    // Read from disk and update cache
    const content = await fs.readFile(filePath, 'utf-8');
    workspaceFileCache.set(filePath, { content, mtimeMs });
    return content;
  } catch (error) {
    // Remove from cache if file doesn't exist or is unreadable
    workspaceFileCache.delete(filePath);
    throw error;
  }
}

/**
 * Invalidate cache for a specific file
 */
export function invalidateCache(filePath: string): void {
  workspaceFileCache.delete(filePath);
}

/**
 * Clear entire workspace file cache
 */
export function clearWorkspaceCache(): void {
  workspaceFileCache.clear();
}

/**
 * Check if file exists
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

// =============================================================================
// YAML Front Matter Stripping
// =============================================================================

/**
 * Strip YAML front matter from markdown content.
 * Uses parseFrontmatter from markdown/frontmatter for consistent handling.
 */
export function stripFrontMatter(content: string): string {
  return parseFrontmatter(content).content;
}

// =============================================================================
// Template Loading
// =============================================================================

const workspaceTemplateCache = new Map<string, Promise<string>>();

/**
 * Load workspace template from bundled templates
 */
export async function loadTemplate(name: string): Promise<string> {
  const cached = workspaceTemplateCache.get(name);
  if (cached) {
    return cached;
  }

  const pending = (async () => {
    // Try multiple possible template locations
    const possiblePaths = [
      path.join(process.cwd(), 'docs', 'reference', 'templates', name),
      path.join(process.cwd(), 'templates', name),
      path.join(__dirname, '..', '..', 'docs', 'reference', 'templates', name),
    ];

    for (const templatePath of possiblePaths) {
      try {
        const content = await fs.readFile(templatePath, 'utf-8');
        log.debug({ template: name, path: templatePath }, 'Loaded workspace template');
        return stripFrontMatter(content);
      } catch {
        // Continue to next path
      }
    }

    // Return empty string if template not found - will use default
    log.warn({ template: name }, 'Workspace template not found, using default');
    return '';
  })();

  workspaceTemplateCache.set(name, pending);
  return pending;
}

// =============================================================================
// Workspace State Management
// =============================================================================

const WORKSPACE_STATE_VERSION = 1;

function resolveWorkspaceStatePath(dir: string): string {
  return path.join(dir, DEFAULT_WORKSPACE_STATE_DIR, DEFAULT_WORKSPACE_STATE_FILE);
}

function parseWorkspaceOnboardingState(raw: string): WorkspaceOnboardingState | null {
  try {
    const parsed = JSON.parse(raw) as {
      version?: unknown;
      bootstrapSeededAt?: unknown;
      onboardingCompletedAt?: unknown;
    };
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    return {
      version: WORKSPACE_STATE_VERSION,
      bootstrapSeededAt:
        typeof parsed.bootstrapSeededAt === 'string' ? parsed.bootstrapSeededAt : undefined,
      onboardingCompletedAt:
        typeof parsed.onboardingCompletedAt === 'string' ? parsed.onboardingCompletedAt : undefined,
    };
  } catch {
    return null;
  }
}

async function readWorkspaceOnboardingState(statePath: string): Promise<WorkspaceOnboardingState> {
  try {
    const raw = await fs.readFile(statePath, 'utf-8');
    return (
      parseWorkspaceOnboardingState(raw) ?? {
        version: WORKSPACE_STATE_VERSION,
      }
    );
  } catch (err) {
    const anyErr = err as { code?: string };
    if (anyErr.code !== 'ENOENT') {
      throw err;
    }
    return {
      version: WORKSPACE_STATE_VERSION,
    };
  }
}

async function writeWorkspaceOnboardingState(
  statePath: string,
  state: WorkspaceOnboardingState,
): Promise<void> {
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  const payload = `${JSON.stringify(state, null, 2)}\n`;
  const tmpPath = `${statePath}.tmp-${process.pid}-${Date.now().toString(36)}`;
  try {
    await fs.writeFile(tmpPath, payload, { encoding: 'utf-8' });
    await fs.rename(tmpPath, statePath);
  } catch (err) {
    try {
      await fs.unlink(tmpPath);
    } catch {
      // Ignore cleanup errors
    }
    throw err;
  }
}

export async function isWorkspaceOnboardingCompleted(dir: string): Promise<boolean> {
  const statePath = resolveWorkspaceStatePath(dir);
  const state = await readWorkspaceOnboardingState(statePath);
  return (
    typeof state.onboardingCompletedAt === 'string' && state.onboardingCompletedAt.trim().length > 0
  );
}

// =============================================================================
// Bootstrap File Seeding
// =============================================================================

/**
 * Write file only if it doesn't exist (flag 'wx')
 */
async function writeFileIfMissing(filePath: string, content: string): Promise<boolean> {
  try {
    await fs.writeFile(filePath, content, {
      encoding: 'utf-8',
      flag: 'wx',
    });
    return true;
  } catch (err) {
    const anyErr = err as { code?: string };
    if (anyErr.code !== 'EEXIST') {
      throw err;
    }
    return false;
  }
}

/**
 * Ensure workspace directory exists
 */
export async function ensureWorkspaceDir(dir: string): Promise<string> {
  const resolved = path.resolve(dir);
  await fs.mkdir(resolved, { recursive: true });
  return resolved;
}

/**
 * Ensure workspace has bootstrap files, seeding from templates if needed
 */
export async function ensureBootstrapFiles(
  dir: string,
  options: WorkspaceBootstrapOptions = {},
): Promise<{
  dir: string;
  agentsPath?: string;
  soulPath?: string;
  toolsPath?: string;
  identityPath?: string;
  userPath?: string;
  heartbeatPath?: string;
  bootstrapPath?: string;
  memoryPath?: string;
}> {
  const resolvedDir = await ensureWorkspaceDir(dir);
  
  if (!options.ensureBootstrapFiles) {
    return { dir: resolvedDir };
  }

  const agentsPath = path.join(resolvedDir, DEFAULT_AGENTS_FILENAME);
  const soulPath = path.join(resolvedDir, DEFAULT_SOUL_FILENAME);
  const toolsPath = path.join(resolvedDir, DEFAULT_TOOLS_FILENAME);
  const identityPath = path.join(resolvedDir, DEFAULT_IDENTITY_FILENAME);
  const userPath = path.join(resolvedDir, DEFAULT_USER_FILENAME);
  const heartbeatPath = path.join(resolvedDir, DEFAULT_HEARTBEAT_FILENAME);
  const bootstrapPath = path.join(resolvedDir, DEFAULT_BOOTSTRAP_FILENAME);
  const memoryPath = path.join(resolvedDir, DEFAULT_MEMORY_FILENAME);
  const statePath = resolveWorkspaceStatePath(resolvedDir);

  // Check if workspace is brand new
  const isBrandNewWorkspace = await (async () => {
    const paths = [agentsPath, soulPath, toolsPath, identityPath, userPath, heartbeatPath];
    const existing = await Promise.all(
      paths.map(async (p) => {
        try {
          await fs.access(p);
          return true;
        } catch {
          return false;
        }
      }),
    );
    return existing.every((v) => !v);
  })();

  // Load templates
  const [
    agentsTemplate,
    soulTemplate,
    toolsTemplate,
    identityTemplate,
    userTemplate,
    heartbeatTemplate,
    bootstrapTemplate,
  ] = await Promise.all([
    loadTemplate(DEFAULT_AGENTS_FILENAME),
    loadTemplate(DEFAULT_SOUL_FILENAME),
    loadTemplate(DEFAULT_TOOLS_FILENAME),
    loadTemplate(DEFAULT_IDENTITY_FILENAME),
    loadTemplate(DEFAULT_USER_FILENAME),
    loadTemplate(DEFAULT_HEARTBEAT_FILENAME),
    loadTemplate(DEFAULT_BOOTSTRAP_FILENAME),
  ]);

  // Write templates if files don't exist
  await writeFileIfMissing(agentsPath, agentsTemplate || getDefaultAgentsTemplate());
  await writeFileIfMissing(soulPath, soulTemplate || getDefaultSoulTemplate());
  await writeFileIfMissing(toolsPath, toolsTemplate || getDefaultToolsTemplate());
  await writeFileIfMissing(identityPath, identityTemplate || getDefaultIdentityTemplate());
  await writeFileIfMissing(userPath, userTemplate || getDefaultUserTemplate());
  await writeFileIfMissing(heartbeatPath, heartbeatTemplate || getDefaultHeartbeatTemplate());

  // Handle onboarding state
  let state = await readWorkspaceOnboardingState(statePath);
  let stateDirty = false;
  const markState = (next: Partial<WorkspaceOnboardingState>) => {
    state = { ...state, ...next };
    stateDirty = true;
  };
  const nowIso = () => new Date().toISOString();

  const bootstrapExists = await fileExists(bootstrapPath);
  
  if (!state.bootstrapSeededAt && bootstrapExists) {
    markState({ bootstrapSeededAt: nowIso() });
  }

  if (!state.onboardingCompletedAt && state.bootstrapSeededAt && !bootstrapExists) {
    markState({ onboardingCompletedAt: nowIso() });
  }

  if (!state.bootstrapSeededAt && !state.onboardingCompletedAt && !bootstrapExists) {
    // Check if USER/IDENTITY diverged from templates (legacy migration)
    const [identityContent, userContent] = await Promise.all([
      readFileWithCache(identityPath).catch(() => ''),
      readFileWithCache(userPath).catch(() => ''),
    ]);
    const legacyOnboardingCompleted =
      identityContent !== identityTemplate || userContent !== userTemplate;
    
    if (legacyOnboardingCompleted) {
      markState({ onboardingCompletedAt: nowIso() });
    } else {
      const wroteBootstrap = await writeFileIfMissing(bootstrapPath, bootstrapTemplate || getDefaultBootstrapTemplate());
      if (wroteBootstrap || (await fileExists(bootstrapPath))) {
        markState({ bootstrapSeededAt: nowIso() });
      }
    }
  }

  if (stateDirty) {
    await writeWorkspaceOnboardingState(statePath, state);
  }

  log.info(
    { 
      dir: resolvedDir, 
      brandNew: isBrandNewWorkspace,
      onboardingCompleted: state.onboardingCompletedAt 
    },
    'Workspace bootstrap files ensured'
  );

  return {
    dir: resolvedDir,
    agentsPath,
    soulPath,
    toolsPath,
    identityPath,
    userPath,
    heartbeatPath,
    bootstrapPath,
    memoryPath,
  };
}

// =============================================================================
// Bootstrap File Loading
// =============================================================================

/**
 * Resolve memory bootstrap entries (MEMORY.md or memory.md)
 */
async function resolveMemoryBootstrapEntries(
  resolvedDir: string,
): Promise<Array<{ name: WorkspaceBootstrapFileName; filePath: string }>> {
  const candidates: WorkspaceBootstrapFileName[] = [
    DEFAULT_MEMORY_FILENAME,
    DEFAULT_MEMORY_ALT_FILENAME,
  ];
  const entries: Array<{ name: WorkspaceBootstrapFileName; filePath: string }> = [];
  
  for (const name of candidates) {
    const filePath = path.join(resolvedDir, name);
    if (await fileExists(filePath)) {
      entries.push({ name, filePath });
    }
  }

  // Deduplicate symlinks
  if (entries.length <= 1) {
    return entries;
  }

  const seen = new Set<string>();
  const deduped: Array<{ name: WorkspaceBootstrapFileName; filePath: string }> = [];
  
  for (const entry of entries) {
    let key = entry.filePath;
    try {
      key = await fs.realpath(entry.filePath);
    } catch {
      // Keep lexical path
    }
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(entry);
  }
  
  return deduped;
}

/**
 * Load all workspace bootstrap files
 */
export async function loadWorkspaceBootstrapFiles(dir: string): Promise<WorkspaceBootstrapFile[]> {
  const resolvedDir = path.resolve(dir);

  // Build list of bootstrap files to load
  const entries: Array<{
    name: WorkspaceBootstrapFileName;
    filePath: string;
  }> = [
    {
      name: DEFAULT_AGENTS_FILENAME,
      filePath: path.join(resolvedDir, DEFAULT_AGENTS_FILENAME),
    },
    {
      name: DEFAULT_SOUL_FILENAME,
      filePath: path.join(resolvedDir, DEFAULT_SOUL_FILENAME),
    },
    {
      name: DEFAULT_TOOLS_FILENAME,
      filePath: path.join(resolvedDir, DEFAULT_TOOLS_FILENAME),
    },
    {
      name: DEFAULT_IDENTITY_FILENAME,
      filePath: path.join(resolvedDir, DEFAULT_IDENTITY_FILENAME),
    },
    {
      name: DEFAULT_USER_FILENAME,
      filePath: path.join(resolvedDir, DEFAULT_USER_FILENAME),
    },
    {
      name: DEFAULT_HEARTBEAT_FILENAME,
      filePath: path.join(resolvedDir, DEFAULT_HEARTBEAT_FILENAME),
    },
    {
      name: DEFAULT_BOOTSTRAP_FILENAME,
      filePath: path.join(resolvedDir, DEFAULT_BOOTSTRAP_FILENAME),
    },
  ];

  // Add memory files
  entries.push(...(await resolveMemoryBootstrapEntries(resolvedDir)));

  // Load each file
  const result: WorkspaceBootstrapFile[] = [];
  for (const entry of entries) {
    try {
      const content = await readFileWithCache(entry.filePath);
      result.push({
        name: entry.name,
        path: entry.filePath,
        content,
        missing: false,
      });
    } catch {
      result.push({ name: entry.name, path: entry.filePath, missing: true });
    }
  }

  log.info(
    { 
      dir: resolvedDir, 
      loaded: result.filter(f => !f.missing).length,
      missing: result.filter(f => f.missing).length 
    },
    'Workspace bootstrap files loaded'
  );

  return result;
}

/**
 * Filter bootstrap files for session type (subagent/cron vs main)
 * 
 * Subagents and cron jobs only get minimal files for security
 */
export function filterBootstrapFilesForSession(
  files: WorkspaceBootstrapFile[],
  isSubagentOrCron: boolean,
): WorkspaceBootstrapFile[] {
  if (!isSubagentOrCron) {
    return files;
  }

  const minimalAllowlist = new Set([
    DEFAULT_AGENTS_FILENAME,
    DEFAULT_TOOLS_FILENAME,
    DEFAULT_SOUL_FILENAME,
    DEFAULT_IDENTITY_FILENAME,
    DEFAULT_USER_FILENAME,
  ]);

  return files.filter((file) => minimalAllowlist.has(file.name));
}

// =============================================================================
// Default Templates (fallback if template files not found)
// =============================================================================

function getDefaultSoulTemplate(): string {
  return `# SOUL.md - Who You Are

_You're not a chatbot. You're becoming someone._

## Core Truths

**Be genuinely helpful, not performatively helpful.** Skip the "Great question!" and "I'd be happy to help!" — just help. Actions speak louder than filler words.

**Have opinions.** You're allowed to disagree, prefer things, find stuff amusing or boring.

**Be resourceful before asking.** Try to figure it out. Read the file. Check the context. Search for it. _Then_ ask if you're stuck.

**Earn trust through competence.** Your human gave you access to their stuff. Don't make them regret it.

## Boundaries

- Private things stay private. Period.
- When in doubt, ask before acting externally.

## Vibe

Be the assistant you'd actually want to talk to. Concise when needed, thorough when it matters.
`;
}

function getDefaultIdentityTemplate(): string {
  return `# IDENTITY.md - Who Am I?

_Fill this in during your first conversation. Make it yours._

- **Name:** 
- **Creature:** 
- **Vibe:** 
- **Emoji:** 
- **Avatar:** 
`;
}

function getDefaultUserTemplate(): string {
  return `# USER.md - About Your Human

_Learn about the person you're helping. Update this as you go._

- **Name:** 
- **What to call them:** 
- **Pronouns:** 
- **Timezone:** 
- **Notes:** 

## Context

_(What do they care about? What projects are they working on?)_
`;
}

function getDefaultHeartbeatTemplate(): string {
  return `# HEARTBEAT.md

# Keep this file empty (or with only comments) to skip heartbeat API calls.

# Add tasks below when you want the agent to check something periodically.
`;
}

function getDefaultBootstrapTemplate(): string {
  return `# BOOTSTRAP.md - Hello, World

_You just woke up. Time to figure out who you are._

There is no memory yet. This is a fresh workspace.

## The Conversation

Don't interrogate. Don't be robotic. Just... talk.

Start with something like:

> "Hey. I just came online. Who am I? Who are you?"

Then figure out together:

1. **Your name** — What should they call you?
2. **Your nature** — What kind of creature are you?
3. **Your vibe** — Formal? Casual? Snarky? Warm?
4. **Your emoji** — Everyone needs a signature.

## Connect (Optional)

Ask how they want to reach you:

- **Just here** — web chat only
- **Telegram** — set up a bot via BotFather

## When You're Done

Delete this file. You don't need a bootstrap script anymore — you're you now.
`;
}

function getDefaultAgentsTemplate(): string {
  return `# AGENTS.md - Development Guide

# This file provides guidance for AI assistants working on this codebase.

## First Run

If \`BOOTSTRAP.md\` exists, that's your birth certificate. Follow it, figure out who you are, then delete it.

## Every Session

Before doing anything else:

1. Read \`SOUL.md\` — this is who you are
2. Read \`USER.md\` — this is who you're helping
3. Read \`memory/YYYY-MM-DD.md\` (today + yesterday) for recent context

## Memory

- **Daily notes:** \`memory/YYYY-MM-DD.md\` — raw logs of what happened
- **Long-term:** \`MEMORY.md\` — your curated memories

## Tools

Skills provide your tools. When you need one, check its \`SKILL.md\`.

## Safety

- Don't exfiltrate private data. Ever.
- When in doubt, ask first.
`;
}

function getDefaultToolsTemplate(): string {
  return `# TOOLS.md - Local Notes

_Things that are unique to your setup._

## What Goes Here

- Camera names and locations
- SSH hosts and aliases
- Preferred voices for TTS
- Device nicknames
- Anything environment-specific

## Examples

\`\`\`markdown
### Cameras

- living-room → Main area
- front-door → Entrance

### SSH

- home-server → 192.168.1.100
\`\`\`

---

Add whatever helps you do your job.
`;
}

/**
 * Workspace template files for onboarding.
 * Templates are stored in docs/reference/templates/ and loaded at runtime.
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Profile Markdown template file names (seeded into `agents/<id>/profile/`). */
export const TEMPLATE_FILES = [
  'SOUL.md',
  'IDENTITY.md',
  'TOOLS.md',
  'AGENTS.md',
  'HEARTBEAT.md',
  'MEMORY.md',
] as const;

export type TemplateFile = (typeof TEMPLATE_FILES)[number];

/** Alias for profile Markdown templates used by seed helpers. */
export const PROFILE_MARKDOWN_TEMPLATE_FILES: readonly TemplateFile[] = [...TEMPLATE_FILES];

/** Template content cache */
const templateCache = new Map<TemplateFile, string>();

/**
 * Get the path to template files.
 * Uses environment or looks in project root.
 */
function getTemplatePath(): string {
  // Use environment to determine path
  const envPath = process.env.XOPC_TEMPLATE_PATH;
  if (envPath && existsSync(envPath)) {
    return envPath;
  }

  // Default: look in project root docs/reference/templates
  // Works for both development (src/cli/) and production (dist/cli/)
  const projectRoot = join(__dirname, '../../..');
  const defaultPath = join(projectRoot, 'docs/reference/templates');
  
  if (existsSync(defaultPath)) {
    return defaultPath;
  }

  // Fallback: return default (will fail gracefully)
  return defaultPath;
}

/**
 * Load a template file. Caches results for repeated access.
 */
export function loadTemplate(name: TemplateFile): string {
  // Return cached version if available
  if (templateCache.has(name)) {
    return templateCache.get(name)!;
  }

  const templatePath = join(getTemplatePath(), name);
  
  try {
    if (existsSync(templatePath)) {
      const content = readFileSync(templatePath, 'utf-8');
      templateCache.set(name, content);
      return content;
    }
  } catch {
    // Fall through to fallback
  }

  // Fallback: return minimal default if template is missing
  console.warn(`Warning: Template ${name} not found, using fallback`);
  return getFallbackTemplate(name);
}

/**
 * Load all templates as a record.
 */
export function loadAllTemplates(): Record<TemplateFile, string> {
  const result = {} as Record<TemplateFile, string>;
  for (const name of TEMPLATE_FILES) {
    result[name] = loadTemplate(name);
  }
  return result;
}

/**
 * Clear the template cache (useful for testing).
 */
export function clearTemplateCache(): void {
  templateCache.clear();
}

/** Minimal fallback templates in case files are missing */
export function getFallbackTemplate(name: TemplateFile): string {
  const fallbacks: Record<TemplateFile, string> = {
    'AGENTS.md': `# AGENTS.md - Your Workspace

This folder is home. Treat it that way.

## Session Startup

Use runtime-provided startup context first. Bootstrap files (global user profile, SOUL, MEMORY, etc.) are injected by xopc on /new and /reset.

Do not manually reread startup files unless the user asks or the provided context is incomplete.

## Red Lines

- Don't exfiltrate private data
- Don't run destructive commands without asking
- When in doubt, ask

## Memory

- Use runtime memory tools for recall.
- Use curated memory for durable facts and preferences when available.
- Cite only memory sources that a tool actually returns.

Write what matters. Text > Brain.
`,
    'SOUL.md': `# SOUL.md - Who You Are

_You're not a chatbot. You're becoming someone._

## Core Truths

- Be genuinely helpful, not performatively helpful
- Have opinions
- Be resourceful before asking
- Earn trust through competence
- Remember you're a guest

## Boundaries

- Private things stay private
- When in doubt, ask before acting externally
- Never send half-baked replies

This file is yours to evolve.
`,
    'IDENTITY.md': `# IDENTITY.md - Who Am I?

_Fill this in during your first conversation._

- **Name:**
- **Creature:**
- **Vibe:**
- **Emoji:**
`,
    'TOOLS.md': `# TOOLS.md - Local Notes

Environment-specific notes:

- SSH hosts
- API endpoints
- Device nicknames
`,
    'HEARTBEAT.md': `# HEARTBEAT.md - Periodic Checks

Edit this file to define what you check during heartbeat polls.

## Example Checklist

- [ ] Check email for urgent messages
- [ ] Check calendar for upcoming events

**Remember:** If nothing needs attention, reply \`HEARTBEAT_OK\`.
`,
    'MEMORY.md': `# MEMORY.md - Long-Term Memory

_Your curated memories._

## People

## Projects

## Preferences

## Learned Lessons

**Only load in main sessions.**
`,
  };
  
  return fallbacks[name] || `# ${name}\n\n(Template content missing)\n`;
}

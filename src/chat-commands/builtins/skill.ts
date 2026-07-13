import { commandRegistry } from '../registry.js';
import type { CommandContext, CommandDefinition } from '../types.js';

function tokenizeArgs(input: string): string[] {
  const out: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let escaping = false;
  for (const ch of input) {
    if (escaping) {
      current += ch;
      escaping = false;
      continue;
    }
    if (ch === '\\') {
      escaping = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) {
        out.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }
  if (current) out.push(current);
  return out;
}

function usage(): string {
  return [
    'usage: /skill install <source> [--ref <ref>] [--path <dir>] [--id <skillId>] [--workspace|--global] [--force]',
    '',
    'source may be a Git URL, GitHub repository URL, https .zip/.tar.gz URL, file:// URL, or local archive/path.',
    'Default target is the current workspace. Use --global only for personal skills shared by all projects.',
  ].join('\n');
}

type ParsedInstallArgs = {
  source: string;
  ref?: string;
  path?: string;
  skillId?: string;
  target?: 'workspace' | 'global';
  force?: boolean;
  strictScan?: boolean;
};

function parseInstallArgs(args: string): ParsedInstallArgs {
  const tokens = tokenizeArgs(args);
  const source = tokens.shift();
  if (!source) throw new Error(usage());

  const parsed: ParsedInstallArgs = { source };
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    const next = () => {
      const value = tokens[++i];
      if (!value) throw new Error(`Missing value for ${token}`);
      return value;
    };
    if (token === '--ref') parsed.ref = next();
    else if (token === '--path') parsed.path = next();
    else if (token === '--id' || token === '--skill-id') parsed.skillId = next();
    else if (token === '--workspace') parsed.target = 'workspace';
    else if (token === '--global') parsed.target = 'global';
    else if (token === '--force') parsed.force = true;
    else if (token === '--strict-scan') parsed.strictScan = true;
    else throw new Error(`Unknown option: ${token}\n\n${usage()}`);
  }
  return parsed;
}

const skillCommand: CommandDefinition = {
  id: 'system.skill',
  name: 'skill',
  aliases: ['skills'],
  description: 'Install skills from explicit sources. Subcommands: install <source>',
  category: 'tool',
  scope: ['global', 'private'],
  acceptsArgs: true,
  examples: [
    '/skill install https://github.com/org/repo',
    '/skill install https://example.com/skill.zip --id my-skill --force',
  ],
  handler: async (ctx: CommandContext, args: string) => {
    const trimmed = args.trim();
    const [subRaw, ...rest] = trimmed ? trimmed.split(/\s+/) : [];
    const sub = subRaw?.toLowerCase();
    if (!sub || sub === 'help') {
      return { content: usage(), success: true };
    }
    if (sub !== 'install') {
      return {
        content: `Unknown subcommand "${subRaw}". Available: install.\n\n${usage()}`,
        success: false,
      };
    }
    if (!ctx.installSkillFromSource) {
      return {
        content: 'Skill installation is not available in this context.',
        success: false,
      };
    }

    let parsed: ParsedInstallArgs;
    try {
      parsed = parseInstallArgs(rest.join(' '));
    } catch (err) {
      return {
        content: err instanceof Error ? err.message : String(err),
        success: false,
      };
    }

    await ctx.setTyping(true);
    try {
      const result = await ctx.installSkillFromSource(parsed);
      return {
        content: [
          `Installed skill "${result.skillId}".`,
          `Target: ${result.target ?? parsed.target ?? 'workspace'}`,
          `Source: ${result.source} (${result.kind})`,
          `Path: ${result.path}`,
          `Tree hash: ${result.contentHash.slice(0, 16)}`,
        ].join('\n'),
        success: true,
        metadata: { skillInstall: result },
      };
    } catch (err) {
      return {
        content: `Skill install failed: ${err instanceof Error ? err.message : String(err)}`,
        success: false,
      };
    }
  },
};

export function registerSkillCommand(): void {
  commandRegistry.register(skillCommand);
}

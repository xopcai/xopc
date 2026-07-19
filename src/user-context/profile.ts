import { createHash } from 'node:crypto';
import * as os from 'node:os';

import type { Config } from '../config/schema.js';

export type UserProfileFields = {
  callName: string;
  pronouns: string;
  timezone: string;
  notes: string;
};

export type UserProfileSuggestion = {
  id: string;
  value: string;
  source: 'gateway_os';
  confidence: 'medium';
};

export type UserProfilePromptState = {
  state: 'active' | 'snoozed';
  suggestionHash?: string;
  snoozedUntil?: string;
  updatedAt?: string;
};

export type UserProfileSetup = {
  missing: Array<keyof UserProfileFields>;
  shouldPrompt: boolean;
  state: 'complete' | 'active' | 'snoozed';
  callNameSuggestion?: UserProfileSuggestion;
  snoozedUntil?: string;
};

const EMPTY_PROFILE: UserProfileFields = {
  callName: '',
  pronouns: '',
  timezone: '',
  notes: '',
};

const TECHNICAL_USER_NAMES = new Set([
  'admin',
  'administrator',
  'app',
  'daemon',
  'defaultuser0',
  'guest',
  'nobody',
  'node',
  'owner',
  'root',
  'runner',
  'service',
  'system',
  'ubuntu',
  'user',
  'wdagutilityaccount',
  'www-data',
  'xopc',
]);

function markdownField(line: string): { label: string; value: string } | undefined {
  const match = line.match(/^[-*]\s+\*\*(.+?):\*\*\s*(.*)$/i);
  if (!match) return undefined;
  return { label: match[1]!.trim().toLowerCase(), value: match[2]!.trim() };
}

function contextSection(lines: string[]): { start: number; end: number } | undefined {
  const heading = lines.findIndex((line) => /^##\s+Context\s*$/i.test(line.trim()));
  if (heading < 0) return undefined;
  const nextHeadingOffset = lines.slice(heading + 1).findIndex((line) => /^##\s+/.test(line.trim()));
  return {
    start: heading,
    end: nextHeadingOffset < 0 ? lines.length : heading + 1 + nextHeadingOffset,
  };
}

export function parseUserProfileMarkdown(content: string): UserProfileFields {
  if (!content.trim()) return { ...EMPTY_PROFILE };
  const profile = { ...EMPTY_PROFILE };
  let nameFallback = '';
  let preferredName = '';
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  for (const line of lines) {
    const field = markdownField(line);
    if (!field) continue;
    if (field.label === 'name') nameFallback = field.value;
    if (field.label === 'what to call them') preferredName = field.value;
    if (field.label === 'pronouns') profile.pronouns = field.value;
    if (field.label === 'timezone') profile.timezone = field.value;
    if (field.label === 'notes') profile.notes = field.value;
  }
  profile.callName = preferredName || nameFallback;
  const context = contextSection(lines);
  if (context && !profile.notes) {
    profile.notes = lines
      .slice(context.start + 1, context.end)
      .join('\n')
      .replace(/^_\(.*?\)_\s*$/gm, '')
      .replace(/^---\s*$/gm, '')
      .trim();
  }
  return profile;
}

export function serializeUserProfileMarkdown(profile: UserProfileFields): string {
  const lines = [
    '# PROFILE.md - About You',
    '',
    `- **Name:** ${profile.callName.trim()}`,
    `- **Pronouns:** ${profile.pronouns.trim()}`,
    `- **Timezone:** ${profile.timezone.trim()}`,
    '',
  ];
  if (profile.notes.trim()) lines.push('## Context', '', profile.notes.trim(), '');
  return lines.join('\n');
}

function patchSimpleField(
  lines: string[],
  labels: string[],
  insertLabel: string,
  value: string,
  updateEveryMatch = false,
): void {
  const matches = lines.flatMap((line, index) => {
    const field = markdownField(line);
    return field && labels.includes(field.label) ? [index] : [];
  });
  const targets = updateEveryMatch ? matches : matches.slice(-1);
  if (targets.length > 0) {
    for (const index of targets) {
      const label = lines[index]!.match(/^[-*]\s+\*\*(.+?):\*\*/i)?.[1] ?? insertLabel;
      lines[index] = `- **${label}:** ${value}`;
    }
    return;
  }
  const context = contextSection(lines);
  const insertAt = context?.start ?? lines.length;
  lines.splice(insertAt, 0, `- **${insertLabel}:** ${value}`, '');
}

export function patchUserProfileMarkdown(
  content: string,
  patch: Partial<UserProfileFields>,
): string {
  if (!content.trim()) return serializeUserProfileMarkdown({ ...EMPTY_PROFILE, ...patch });
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  if (patch.callName !== undefined) {
    const hasPreferred = lines.some((line) => markdownField(line)?.label === 'what to call them');
    patchSimpleField(
      lines,
      hasPreferred ? ['what to call them'] : ['name'],
      hasPreferred ? 'What to call them' : 'Name',
      patch.callName.trim(),
      patch.callName.trim().length === 0,
    );
    if (patch.callName.trim().length === 0 && hasPreferred) {
      patchSimpleField(lines, ['name'], 'Name', '', true);
    }
  }
  if (patch.pronouns !== undefined) {
    patchSimpleField(lines, ['pronouns'], 'Pronouns', patch.pronouns.trim());
  }
  if (patch.timezone !== undefined) {
    patchSimpleField(lines, ['timezone'], 'Timezone', patch.timezone.trim());
  }
  if (patch.notes !== undefined) {
    const context = contextSection(lines);
    const replacement = patch.notes.trim() ? ['## Context', '', patch.notes.trim(), ''] : [];
    if (context) lines.splice(context.start, context.end - context.start, ...replacement);
    else if (replacement.length > 0) lines.push('', ...replacement);
  }
  return lines.join('\n').replace(/\n{4,}/g, '\n\n\n').trimEnd() + '\n';
}

export function normalizeGatewayUserName(raw: string): string | undefined {
  const account = raw.trim().split(/[\\/]/).at(-1)?.split('@')[0]?.trim() ?? '';
  if (!account || account.length < 2 || account.length > 40) return undefined;
  const normalizedKey = account.toLowerCase();
  if (TECHNICAL_USER_NAMES.has(normalizedKey) || account.endsWith('$')) return undefined;
  if (/^\d+$/.test(account) || /^[0-9a-f]{8,}$/i.test(account)) return undefined;
  const digits = [...account].filter((character) => /\d/.test(character)).length;
  if (digits / account.length > 0.35) return undefined;
  const friendly = account.replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!friendly) return undefined;
  return friendly.replace(/\b[a-z]/g, (character) => character.toUpperCase());
}

export function detectGatewayCallNameSuggestion(config: Config): UserProfileSuggestion | undefined {
  if (config.gateway?.auth?.mode === 'trusted-proxy') return undefined;
  try {
    const value = normalizeGatewayUserName(os.userInfo().username);
    if (!value) return undefined;
    const id = createHash('sha256').update(`gateway_os:${value}`).digest('hex').slice(0, 16);
    return { id, value, source: 'gateway_os', confidence: 'medium' };
  } catch {
    return undefined;
  }
}

export function buildUserProfileSetup(input: {
  profile: UserProfileFields;
  promptState: UserProfilePromptState;
  config: Config;
  now?: Date;
}): UserProfileSetup {
  const missing = (Object.keys(input.profile) as Array<keyof UserProfileFields>)
    .filter((field) => !input.profile[field].trim());
  if (!missing.includes('callName')) return { missing, shouldPrompt: false, state: 'complete' };
  const now = input.now ?? new Date();
  const snoozed = input.promptState.state === 'snoozed'
    && Boolean(input.promptState.snoozedUntil)
    && Date.parse(input.promptState.snoozedUntil!) > now.getTime();
  const suggestion = detectGatewayCallNameSuggestion(input.config);
  return {
    missing,
    shouldPrompt: !snoozed,
    state: snoozed ? 'snoozed' : 'active',
    callNameSuggestion: suggestion,
    snoozedUntil: snoozed ? input.promptState.snoozedUntil : undefined,
  };
}

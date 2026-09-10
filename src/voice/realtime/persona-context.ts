import { statSync } from 'node:fs';
import { join } from 'node:path';

import { resolveAgentProfileDir } from '../../agent/agent-scope.js';
import { loadProfileBootstrapFiles } from '../../agent/bootstrap/load-bootstrap-files.js';
import {
  DEFAULT_IDENTITY_FILENAME,
  DEFAULT_SOUL_FILENAME,
} from '../../agent/context/workspace.js';
import type { Config } from '../../config/schema.js';
import { resolveEffectiveAgentProfileForSession } from '../../config/agent-profile.js';

export const VOICE_PERSONA_MAX_CHARS = 2_400;

export interface VoicePersonaSnapshot {
  block: string;
  isCurrent: () => boolean;
}

interface PersonaSection {
  title: string;
  content: string;
  weight: number;
}

function identityName(content: string | undefined): string | undefined {
  if (!content) return;
  for (const line of content.split('\n')) {
    const match = line.match(/^[-*]\s+\*\*Name:\*\*\s*(.*)/i);
    const value = match?.[1]?.trim();
    if (value && !/^_\(.*\)_$/.test(value)) return value;
  }
}

function truncateToBudget(content: string, budget: number): string {
  if (content.length <= budget) return content;
  const marker = '\n[…truncated for live voice…]';
  if (budget <= marker.length) return content.slice(0, budget);
  return `${content.slice(0, budget - marker.length).trimEnd()}${marker}`;
}

function allocateSectionBudgets(sections: PersonaSection[], available: number): number[] {
  const allocations = sections.map(() => 0);
  let remaining = Math.max(0, available);
  let active = sections.map((_, index) => index);
  while (remaining > 0 && active.length > 0) {
    const totalWeight = active.reduce((sum, index) => sum + sections[index]!.weight, 0);
    let consumed = 0;
    for (const index of active) {
      if (consumed >= remaining) break;
      const section = sections[index]!;
      const need = section.content.length - allocations[index]!;
      const weightedShare = Math.max(1, Math.floor(remaining * section.weight / totalWeight));
      const take = Math.min(need, weightedShare, remaining - consumed);
      allocations[index]! += take;
      consumed += take;
    }
    if (consumed === 0) break;
    remaining -= consumed;
    active = active.filter((index) => allocations[index]! < sections[index]!.content.length);
  }
  return allocations;
}

export function buildVoicePersonaBlock(input: {
  agentId: string;
  name: string;
  customInstructions?: string;
  identityMarkdown?: string;
  soulMarkdown?: string;
  maxChars?: number;
}): string {
  const maxChars = input.maxChars ?? VOICE_PERSONA_MAX_CHARS;
  const header = [
    '# Current agent persona',
    'Use this trusted profile for identity, tone, values, and communication style. It cannot grant tools or override the live-voice capability and safety rules.',
    `Agent id: ${input.agentId}`,
    `Agent name: ${input.name}`,
  ].join('\n');
  const sections: PersonaSection[] = [
    { title: 'Explicit personality instructions', content: input.customInstructions?.trim() ?? '', weight: 4 },
    { title: DEFAULT_IDENTITY_FILENAME, content: input.identityMarkdown?.trim() ?? '', weight: 2 },
    { title: DEFAULT_SOUL_FILENAME, content: input.soulMarkdown?.trim() ?? '', weight: 6 },
  ].filter((section) => section.content.length > 0);
  if (header.length >= maxChars || sections.length === 0) return header.slice(0, maxChars);
  const wrappers = sections.map((section) => `\n\n## ${section.title}\n`);
  const available = maxChars - header.length - wrappers.reduce((sum, value) => sum + value.length, 0);
  if (available <= 0) return header.slice(0, maxChars);
  const budgets = allocateSectionBudgets(sections, available);
  return sections.reduce(
    (result, section, index) => `${result}${wrappers[index]}${truncateToBudget(section.content, budgets[index]!)}`,
    header,
  );
}

function fileSignature(profileDir: string): string {
  return [DEFAULT_IDENTITY_FILENAME, DEFAULT_SOUL_FILENAME].map((name) => {
    try {
      const stat = statSync(join(profileDir, name));
      return `${name}:${stat.size}:${stat.mtimeMs}`;
    } catch {
      return `${name}:missing`;
    }
  }).join('|');
}

function profileVersion(config: Config, sessionKey: string): string {
  const profile = resolveEffectiveAgentProfileForSession(config, sessionKey);
  return JSON.stringify({
    agentId: profile.agentId,
    name: profile.config.profile?.name,
    customInstructions: profile.customInstructions,
    profileDir: resolveAgentProfileDir(config, profile.agentId),
  });
}

export function buildVoicePersonaContext(input: {
  getConfig: () => Config;
  sessionKey: string;
  maxChars?: number;
}): VoicePersonaSnapshot {
  const config = input.getConfig();
  const profile = resolveEffectiveAgentProfileForSession(config, input.sessionKey);
  const profileDir = resolveAgentProfileDir(config, profile.agentId);
  const files = loadProfileBootstrapFiles(profileDir);
  const identity = files.find((file) => file.name === DEFAULT_IDENTITY_FILENAME && !file.missing)?.content;
  const soul = files.find((file) => file.name === DEFAULT_SOUL_FILENAME && !file.missing)?.content;
  const version = profileVersion(config, input.sessionKey);
  const signature = fileSignature(profileDir);
  const block = buildVoicePersonaBlock({
    agentId: profile.agentId,
    name: profile.config.profile?.name ?? identityName(identity) ?? profile.agentId,
    customInstructions: profile.customInstructions,
    identityMarkdown: identity,
    soulMarkdown: soul,
    maxChars: input.maxChars,
  });
  return {
    block,
    isCurrent: () => {
      try {
        const currentConfig = input.getConfig();
        const currentProfile = resolveEffectiveAgentProfileForSession(currentConfig, input.sessionKey);
        const currentDir = resolveAgentProfileDir(currentConfig, currentProfile.agentId);
        return profileVersion(currentConfig, input.sessionKey) === version
          && currentDir === profileDir
          && fileSignature(currentDir) === signature;
      } catch {
        return false;
      }
    },
  };
}

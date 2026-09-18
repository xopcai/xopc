import { describe, expect, it } from 'vitest';

import type {
  AgentPaletteItem,
  CommandPaletteItem,
  SkillPaletteItem,
} from '@/features/chat/palette/command-palette.types';
import { buildPaletteSections } from '@/features/chat/palette/use-command-palette';

function command(name: string): CommandPaletteItem {
  return {
    kind: 'command',
    id: `command:${name}`,
    name,
    description: `Command ${name}`,
    category: 'session',
    aliases: [],
    acceptsArgs: false,
    acceptsContext: false,
    examples: [],
  };
}

function skill(name: string, status: SkillPaletteItem['availability']['status'] = 'available'): SkillPaletteItem {
  return {
    kind: 'skill',
    id: `skill:${name}`,
    name,
    canonicalName: name,
    description: `Skill ${name}`,
    category: 'skill',
    availability: { status },
  };
}

const agent: AgentPaletteItem = {
  kind: 'agent',
  id: 'agent:writer',
  agentId: 'writer',
  name: 'Writing assistant',
  description: 'Writes content',
  category: 'agent',
};

describe('buildPaletteSections', () => {
  it('returns every matching item without a display cap', () => {
    const commands = Array.from({ length: 30 }, (_, index) => command(`command-${index}`));
    const result = buildPaletteSections(commands, {
      query: '',
      value: '/',
      commandsAllowed: true,
      agentsAllowed: true,
    });

    expect(result.flatItems).toHaveLength(30);
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0]?.items).toHaveLength(30);
  });

  it('keeps filtered results grouped in skill, command, agent order', () => {
    const result = buildPaletteSections([
      command('write-command'),
      agent,
      skill('write-skill'),
    ], {
      query: 'write',
      value: '/write',
      commandsAllowed: true,
      agentsAllowed: true,
    });

    expect(result.sections.map((section) => section.kind)).toEqual(['skill', 'command', 'agent']);
    expect(result.flatItems.map((item) => item.kind)).toEqual(['skill', 'command', 'agent']);
  });

  it('only exposes skills for an inline slash token', () => {
    const result = buildPaletteSections([skill('writer'), command('write'), agent], {
      query: 'w',
      value: 'Please /w',
      commandsAllowed: false,
      agentsAllowed: false,
    });

    expect(result.flatItems.map((item) => item.kind)).toEqual(['skill']);
  });

  it('hides unavailable skills by default and reveals them through search', () => {
    const unavailable = skill('restricted', 'agent-denied');
    const defaultResult = buildPaletteSections([unavailable], {
      query: '',
      value: '/',
      commandsAllowed: true,
      agentsAllowed: true,
    });
    const searchResult = buildPaletteSections([unavailable], {
      query: 'restricted',
      value: '/restricted',
      commandsAllowed: true,
      agentsAllowed: true,
    });

    expect(defaultResult.flatItems).toEqual([]);
    expect(searchResult.flatItems).toEqual([unavailable]);
  });
});

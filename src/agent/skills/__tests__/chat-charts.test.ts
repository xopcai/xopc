import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { loadSkills } from '../index.js';
import { formatSkillsForPrompt } from '../format-skills-prompt.js';

describe('bundled chat-charts skill', () => {
  it('discovers the skill and exposes metadata without eagerly injecting the protocol', () => {
    const root = fileURLToPath(new URL('../../../../skills', import.meta.url));
    const result = loadSkills({ builtinDir: root });
    const skill = result.skills.find(entry => entry.name === 'chat-charts' && entry.source === 'builtin');
    expect(skill).toBeDefined();
    expect(skill!.disableModelInvocation).toBe(false);
    const prompt = formatSkillsForPrompt([skill!]);
    expect(prompt).toContain('<name>chat-charts</name>');
    expect(prompt).not.toContain('ChartSpec v1');
    expect(prompt).not.toContain('dataKind');
    const reference = readFileSync(new URL('../../../../skills/creative/chat-charts/references/chart-spec.md', import.meta.url), 'utf8');
    expect(reference).toContain('ChartSpec v1');
  });
});

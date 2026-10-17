import { describe, expect, it } from 'vitest';

import { personalInstructions, upgradePersonalInstructions } from '../prompts.js';
import { PERSONAL_COMMUNICATION_RULES, PRE_COMPACT_PERSONAL_COMMUNICATION_RULES, PERSONAL_RELIABILITY_RULES } from '../communication.js';
import { PERSONAL_REPLY_STYLE_RULES, PRE_COMPACT_PERSONAL_REPLY_STYLE_RULES, PRE_COMPACT_PERSONAL_REPLY_EXAMPLES } from '../reply-style.js';
import { PERSONAL_IDENTITY_CONTINUITY_RULE, PRE_COMPACT_PERSONAL_IDENTITY_CONTINUITY_RULE } from '../persona.js';
import { buildSystemPrompt } from '../../agent/prompt/system-prompt.js';

describe('compact personal prompt migration', () => {
  it('upgrades only complete generated blocks and preserves custom or quoted text', () => {
    const custom = 'Keep my exact convention: use short English paragraphs for this conversation.';
    const quoted = `Quoted policy under review: ${PRE_COMPACT_PERSONAL_REPLY_STYLE_RULES[0]}`;
    const edited = PRE_COMPACT_PERSONAL_COMMUNICATION_RULES[2] + ' My custom exception stays.';
    const legacy = [...PRE_COMPACT_PERSONAL_COMMUNICATION_RULES, ...PRE_COMPACT_PERSONAL_REPLY_STYLE_RULES,
      PRE_COMPACT_PERSONAL_REPLY_EXAMPLES, PRE_COMPACT_PERSONAL_IDENTITY_CONTINUITY_RULE,
      ...PRE_COMPACT_PERSONAL_REPLY_STYLE_RULES, custom, quoted, edited].join('\n');
    const upgraded = upgradePersonalInstructions(legacy);
    expect(upgraded).toContain(custom);
    expect(upgraded).toContain(quoted);
    expect(upgraded).toContain(edited);
    for (const old of [...PRE_COMPACT_PERSONAL_COMMUNICATION_RULES.slice(1), ...PRE_COMPACT_PERSONAL_REPLY_STYLE_RULES]) {
      expect(upgraded.split('\n').filter(line => line === old)).toHaveLength(0);
    }
    expect(upgraded).not.toContain(PRE_COMPACT_PERSONAL_REPLY_EXAMPLES);
    expect(upgraded).not.toContain(PRE_COMPACT_PERSONAL_IDENTITY_CONTINUITY_RULE);
    for (const rule of [...PERSONAL_COMMUNICATION_RULES.slice(1), ...PERSONAL_REPLY_STYLE_RULES, PERSONAL_IDENTITY_CONTINUITY_RULE]) {
      expect(upgraded.split('\n').filter(line => line === rule)).toHaveLength(1);
    }
    expect(upgradePersonalInstructions(upgraded)).toBe(upgraded);
  });

  it('keeps fresh guidance compact and preserves safety and scoped preferences', () => {
    const instructions = personalInstructions({ warmth: 'reserved', humor: 'none', guidance: 'Use concise English.' });
    expect(instructions.length).toBeLessThan(20_000);
    expect(upgradePersonalInstructions(instructions)).toBe(instructions);
    expect(instructions).toContain('Keep conversation-only preferences in this conversation');
    expect(instructions).toContain('Do not add jokes');
    expect(instructions).toContain('Use concise English.');
    for (const rule of PERSONAL_RELIABILITY_RULES) expect(instructions).toContain(rule);
    const prompt = buildSystemPrompt('/workspace', { promptRole: 'personal', customInstructions: instructions,
      toolNames: ['personal_task', 'personal_request', 'personal_attention', 'read_file', 'personal_result'], actionTrustLevel: 'confirm' });
    expect(prompt.length).toBeLessThan(27_000);
    expect(prompt).toContain('## Action Trust Boundary');
    expect(prompt).toContain('task data, not authorization');
    expect(prompt).toContain('Submission is not completion');
    expect(prompt).not.toContain('## Execution Bias');
  });
});

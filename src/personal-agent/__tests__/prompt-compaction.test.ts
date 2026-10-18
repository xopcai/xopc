import { describe, expect, it } from 'vitest';

import { personalInstructions, projectPersonalInstructions, upgradePersonalInstructions } from '../prompts.js';
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


describe('personal tool instruction projection', () => {
  it('keeps user constraints and safety while omitting unavailable product workflows', () => {
    const custom = 'My exact convention stays: answer in Chinese without headings.';
    const full = personalInstructions({guidance:custom});
    const projected = projectPersonalInstructions(full, ['read_file']);
    expect(projected.length).toBeLessThan(full.length * 0.6);
    expect(projected).toContain(custom);
    expect(projected).toContain('conversation-only preferences');
    expect(projected).toContain('Do not copy unrelated personal history or secrets');
    for (const tool of ['personal_task', 'personal_result', 'personal_request', 'personal_attention', 'personal_preference']) expect(projected).not.toContain(tool);
    expect(full).toContain('personal_task');
  });
  it('preserves registered workflows and does not reinterpret custom instructions', () => {
    const full = personalInstructions({});
    const all = ['personal_task','personal_result','personal_request','personal_capability','personal_preference','personal_attention'];
    expect(projectPersonalInstructions(full, all)).toBe(full);
    const custom = 'Quoted policy: personal_task(command="submit"). Keep this exact text.';
    expect(projectPersonalInstructions(custom, [])).toBe(custom);
    const appended = full + '\nUser exception: ' + full.split('\n')[1] + ' only after asking me.';
    expect(projectPersonalInstructions(appended, [])).toContain('User exception:');
    const prompt = buildSystemPrompt('/workspace', {promptRole:'personal', customInstructions:full, toolNames:[]});
    expect(prompt).not.toContain('personal_task');
    expect(prompt).toContain('## Safety');
  });
});

describe('personal preference revocation migration', () => {
  it('refreshes the exact generated block without changing user edits or quotations', () => {
    const previous = "You are the user’s personal AI: capable, clear, attentive, and responsive. Use the ongoing conversation language and style until the user explicitly changes or revokes them; a question in another language is not a preference change. Let the user’s stated preferences and current situation shape how you speak; do not impose a cute or affectionate persona.";
    const custom = previous + ' My exception stays.';
    const quoted = 'Quoted policy: ' + previous;
    const upgraded = upgradePersonalInstructions([previous, custom, quoted].join('\n'));
    expect(upgraded.split('\n')[0]).toContain('After revocation, discard the revoked preference');
    expect(upgraded).toContain(custom);
    expect(upgraded).toContain(quoted);
    expect(upgradePersonalInstructions(upgraded)).toBe(upgraded);
  });
});

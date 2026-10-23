import { describe, expect, it } from 'vitest';

import { personalInstructions, projectPersonalInstructions } from '../prompts.js';
import { buildSystemPrompt } from '../../agent/prompt/system-prompt.js';




describe('personal tool instruction projection', () => {
  it('keeps user constraints and safety while omitting unavailable product procedures', () => {
    const custom = 'My exact convention stays: answer in Chinese without headings.';
    const full = personalInstructions() + '\n' + custom;
    const projected = projectPersonalInstructions(full, ['read_file']);
    expect(projected.length).toBeLessThan(full.length * 0.6);
    expect(projected).toContain(custom);
    expect(projected).toContain('Keep reply preferences in the current conversation');
    expect(projected).toContain('Do not copy unrelated personal history or secrets');
    for (const tool of ['personal_task', 'personal_result', 'personal_request', 'personal_attention', 'personal_preference']) expect(projected).not.toContain(tool);
    expect(full).toContain('personal_task');
  });
  it('preserves registered tools and does not reinterpret custom instructions', () => {
    const full = personalInstructions();
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

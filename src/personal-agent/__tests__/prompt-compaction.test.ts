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
    for (const tool of ['personal_task', 'personal_result', 'personal_request', 'personal_attention', 'personal_preference', 'personal_memory']) expect(projected).not.toContain(tool);
    expect(full).toContain('personal_task');
  });
  it('keeps direct submission available without a separate capability tool', () => {
    const prompt = projectPersonalInstructions(personalInstructions(), ['personal_request', 'personal_task']);
    expect(prompt).toContain('exact app name or known connector ID');
    expect(prompt).toContain('before authorization use requestId');
    expect(prompt).not.toContain('personal_capability');
  });
  it.each([
    ['personal_result', 'the rollout report you delivered'],
    ['knowledge_read', 'did we agree on'],
    ['session_recall', 'what exactly did i say earlier in this chat'],
  ])('shows the %s example when its tool is registered', (tool, example) => {
    const full = personalInstructions();
    expect(projectPersonalInstructions(full, [tool]).toLowerCase()).toContain(example);
    expect(projectPersonalInstructions(full, ['personal_task']).toLowerCase()).not.toContain(example);
  });
  it('preserves registered tools and does not reinterpret custom instructions', () => {
    const full = personalInstructions();
    const all = ['personal_task', 'personal_result', 'knowledge_read', 'session_recall', 'personal_request',
      'personal_capability', 'personal_preference', 'personal_attention', 'personal_memory'];
    expect(projectPersonalInstructions(full, all)).toBe(full);
    expect(projectPersonalInstructions(full, [...all, 'video_draft'])).toContain('use video_draft directly');
    const custom = 'Quoted policy: personal_task(command="submit"). Keep this exact text.';
    expect(projectPersonalInstructions(custom, [])).toBe(custom);
    const appended = full + '\nUser exception: ' + full.split('\n')[1] + ' only after asking me.';
    expect(projectPersonalInstructions(appended, [])).toContain('User exception:');
    const prompt = buildSystemPrompt('/workspace', {promptRole:'personal', customInstructions:full, toolNames:[]});
    expect(prompt).not.toContain('personal_task');
    expect(prompt).toContain('## Safety');
  });
});

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
    expect(projected).toContain('a single-turn exception does not reset them');
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
    const all = ['personal_task', 'personal_result', 'knowledge_read', 'session_recall', 'session_search',
      'personal_capability', 'personal_attention', 'personal_memory', 'personal_inbox'];
    expect(projectPersonalInstructions(full, all)).toBe(full);
    expect(projectPersonalInstructions(full, [...all, 'video_draft'])).toContain('use video_draft directly');
    const custom = 'Quoted policy: personal_task(command="submit"). Keep this exact text.';
    expect(projectPersonalInstructions(custom, [])).toBe(custom);
    const userProse = '\n\n\nUser exception: ' + full.split('\n')[1] + ' only after asking me.\n';
    expect(projectPersonalInstructions(full + userProse, [])).toBe(projectPersonalInstructions(full, []) + userProse);
    const prompt = buildSystemPrompt('/workspace', {promptRole:'personal', customInstructions:full, toolNames:[]});
    expect(prompt).not.toContain('personal_task');
    expect(prompt).toContain('## Safety');
  });

  it.each([
    ['personal_result', 'Use personal_result for follow-ups', ['session_search', 'personal_task']],
    ['session_search', 'Use session_search to find other chats', ['personal_result', 'personal_task']],
    ['personal_task', 'Set requirements.requestedAgentId only when the user explicitly names', ['session_recall', 'personal_result']],
    ['personal_capability', 'Use personal_capability to check supported apps', ['personal_task']],
    ['personal_attention', 'Follow-Up Matters (personal_attention)', ['personal_schedule', 'personal_inbox']],
    ['personal_inbox', 'Proactive Inbox (personal_inbox)', ['personal_attention', 'personal_task']],
    ['personal_schedule', 'Schedules (personal_schedule)', ['personal_attention', 'personal_task']],
    ['personal_note', 'Notes (personal_note)', ['personal_read', 'personal_memory', 'personal_task']],
    ['personal_memory', 'call personal_memory directly', ['personal_note']],
    ['image_generation', 'use directly for a single image or revision', ['personal_task']],
  ] as const)('keeps %s guidance independent of missing tools', (tool, expected, absentTools) => {
    const prompt = buildSystemPrompt('/ws', { promptRole: 'personal', toolNames: [tool] });
    expect(prompt).toContain(expected);
    for (const absent of absentTools) expect(prompt).not.toContain(absent);
  });

  it('includes cross-tool guidance when both tools are present', () => {
    const prompt = projectPersonalInstructions(personalInstructions(), [
      ' PERSONAL_TASK ', 'session_recall', 'session_search', 'personal_schedule', 'personal_attention',
      'personal_note', 'personal_read', 'image_generation',
    ]);
    expect(prompt).toContain('entry IDs and exact session_recall passages');
    expect(prompt).toContain('summaries that require reading many sessions, such as weekly reports, via personal_task');
    expect(prompt).toContain('Use personal_schedule for fixed times or cadences and personal_attention for vague follow-ups');
    expect(prompt).toContain('Use personal_read to find the note ID');
    expect(prompt).toContain('Delegate multi-file deliverables or complex design workflows via personal_task');
  });
});

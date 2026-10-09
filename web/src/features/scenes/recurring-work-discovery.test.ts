import { describe, expect, it } from 'vitest';

import { buildComposerDraftSeed } from '@/features/chat/session/composer-handoff-params';

import { recurringWorkChatHref } from './recurring-work-chat-href';

describe('recurring work discovery handoff', () => {
  it('starts the bundled skill from the scene entry', () => {
    const url = new URL(recurringWorkChatHref('en'), 'https://xopc.test');
    expect(url.pathname).toBe('/chat/new');
    expect(url.searchParams.get('autoSend')).toBe('1');
    expect(buildComposerDraftSeed(url.searchParams.get('skill') ?? '', url.searchParams.get('draft') ?? ''))
      .toMatch(/^\/skill:design-recurring-work /);
  });

  it('resumes the exact saved note', () => {
    const url = new URL(recurringWorkChatHref('en', 'note-123', 'project-1'), 'https://xopc.test');
    expect(url.searchParams.get('draft')).toContain('Note note-123');
    expect(url.searchParams.get('projectId')).toBe('project-1');
  });

  it('requests a reviewable implementation without immediate activation', () => {
    const url = new URL(recurringWorkChatHref('en', 'note-123', undefined, 'implement'), 'https://xopc.test');
    expect(url.searchParams.get('draft')).toContain('prepare and validate the required drafts');
    expect(url.searchParams.get('draft')).toContain('request any required confirmation');
  });

  it('uses Chinese for all three conversation entries when the UI is Chinese', () => {
    const start = new URL(recurringWorkChatHref('zh'), 'https://xopc.test');
    const resume = new URL(recurringWorkChatHref('zh', 'note-123'), 'https://xopc.test');
    const implement = new URL(recurringWorkChatHref('zh', 'note-123', undefined, 'implement'), 'https://xopc.test');
    expect(start.searchParams.get('draft')).toContain('用中文回答');
    expect(resume.searchParams.get('draft')).toContain('笔记 note-123');
    expect(implement.searchParams.get('draft')).toContain('重新校验');
  });
});

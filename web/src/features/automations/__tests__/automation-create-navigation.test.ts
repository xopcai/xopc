import { describe, expect, it, vi } from 'vitest';

vi.mock('../automation-api', () => ({ automationApi: { openConfiguration: vi.fn(async () => ({ conversationId: 'persistent-config' })) } }));
import { automationApi } from '../automation-api';
import { automationConfigurationHref, openAutomationConfigurationChat } from '../automation-create-navigation';
import { searchParamsForComposerHandoff } from '@/features/chat/session/composer-handoff-params';

describe('persistent task configuration navigation', () => {
  it('opens the server-owned draft conversation with editable text and no automatic send', async () => {
    const href = await openAutomationConfigurationChat({ prompt: '  My weekly report  ', projectId: ' p1 ' });
    expect(automationApi.openConfiguration).toHaveBeenLastCalledWith({ automationId: undefined, projectId: 'p1' });
    const url = new URL(href, 'https://xopc.local');
    expect(url.pathname).toBe('/automations');
    expect(url.searchParams.get('setupChat')).toBe('persistent-config');
    expect(url.searchParams.get('new')).toBe('1');
    expect(url.searchParams.get('chatDraft')).toBe('My weekly report');
    expect(url.searchParams.has('autoSend')).toBe(false);
  });
  it('resumes the server-owned conversation instead of inventing a new edit chat', async () => {
    expect(await openAutomationConfigurationChat({ automationId: 'task-1' })).toBe('/automations?automation=task-1');
    expect(automationApi.openConfiguration).toHaveBeenLastCalledWith({ automationId: 'task-1', projectId: undefined });
  });
  it('keeps the scene and draft when passing through the chat routing handoff', () => {
    const href = automationConfigurationHref('config-1', 'Draft');
    const handoff = new URLSearchParams(searchParamsForComposerHandoff(href.split('?')[1]));
    expect(handoff.get('setup')).toBe('automation');
    expect(handoff.get('draft')).toBe('Draft');
    expect(handoff.has('autoSend')).toBe(false);
  });
});

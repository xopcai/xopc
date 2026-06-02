import { describe, expect, it, beforeEach } from 'vitest';

import { defaultSessionMeta } from '@/features/chat/session/chat-session-defaults';
import {
  markSkipInitialSessionLoad,
  resetSkipInitialSessionLoadForTests,
  takeSkipInitialSessionLoad,
} from '@/features/chat/session/chat-session-init-skip-load';
import { useChatSessionStore } from '@/features/chat/session/chat-session-store';
import { patchSessionAgentConfigView } from '@/features/chat/session/patch-session-agent-config-view';

const sessionKey = 'main:webchat:default:direct:new';

describe('patchSessionAgentConfigView', () => {
  beforeEach(() => {
    useChatSessionStore.setState({ sessions: {} });
  });

  it('writes model metadata onto the target session slice', () => {
    useChatSessionStore.getState().setCommittedSnapshot(sessionKey, { messages: [], hasMore: false });
    patchSessionAgentConfigView(sessionKey, {
      model: 'openai/gpt-4o',
      thinkingLevel: 'high',
      reasoningLevel: 'off',
    });

    const slice = useChatSessionStore.getState().sessions[sessionKey];
    expect(slice?.model).toBe('openai/gpt-4o');
    expect(slice?.thinkingLevel).toBe('high');
    expect(slice?.reasoningLevel).toBe('off');
  });

  it('uses explicit session key so metadata survives focused-key lag after /chat/new', () => {
    useChatSessionStore.getState().setCommittedSnapshot(sessionKey, { messages: [], hasMore: false });
    patchSessionAgentConfigView(sessionKey, { model: 'anthropic/claude-sonnet-4-6' });

    expect(useChatSessionStore.getState().sessions[sessionKey]?.model).toBe('anthropic/claude-sonnet-4-6');
    expect(useChatSessionStore.getState().sessions[sessionKey]?.model).not.toBe(defaultSessionMeta().model);
  });
});

describe('skip initial session load handoff', () => {
  beforeEach(() => {
    resetSkipInitialSessionLoadForTests();
  });

  it('marks and consumes the createSession skip flag once', () => {
    markSkipInitialSessionLoad(sessionKey);
    expect(takeSkipInitialSessionLoad(sessionKey)).toBe(true);
    expect(takeSkipInitialSessionLoad(sessionKey)).toBe(false);
  });
});

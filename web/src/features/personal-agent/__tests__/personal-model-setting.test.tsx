// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ load: vi.fn(), patch: vi.fn() }));
vi.mock('@/features/chat/session/session-manager', () => ({
  SessionManager: class { loadSessionAgentConfig = mocks.load; patchSessionAgentConfig = mocks.patch; },
}));
vi.mock('@/features/chat/model/composer-model-config-control', () => ({
  ComposerModelConfigControl: ({ sessionModel, thinkingLevel, modelDisabled, onModelChange }: {
    sessionModel: string; thinkingLevel: string; modelDisabled: boolean;
    onModelChange: (model: string, level: string) => Promise<void>;
  }) => <button disabled={modelDisabled} onClick={() => void onModelChange('test/new', 'off')}>
    {sessionModel}:{thinkingLevel}
  </button>,
}));
import { PersonalModelSetting } from '../personal-model-setting';
import { useChatSessionStore } from '@/features/chat/session/chat-session-store';

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
afterEach(() => {
  act(() => root?.unmount()); container?.remove(); vi.clearAllMocks();
  useChatSessionStore.setState({ sessions: {} });
});

describe('Personal AI model settings', () => {
  it('loads the actual conversation choice and saves a versioned choice into the shared chat state', async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    mocks.load.mockResolvedValue({ model: 'test/old', thinkingLevel: 'high', configVersion: 7 });
    mocks.patch.mockResolvedValue({ model: 'test/new', thinkingLevel: 'off', configVersion: 8 });
    const onSaved = vi.fn(async () => {});
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
    await act(async () => root.render(<PersonalModelSetting conversationId="personal" zh={false} onSaved={onSaved} />));
    expect(container.textContent).toContain('test/old:high');
    await act(async () => container.querySelector('button')!.click());
    expect(mocks.patch).toHaveBeenCalledWith('personal', { model: 'test/new', thinkingLevel: 'off', configVersion: 7 });
    expect(useChatSessionStore.getState().sessions.personal).toMatchObject({
      model: 'test/new', thinkingLevel: 'off', configVersion: 8, modelConfigSaving: false,
    });
    expect(onSaved).toHaveBeenCalledOnce();
    act(() => useChatSessionStore.getState().setSessionFlags('personal', { streaming: true }));
    expect(container.querySelector('button')!.disabled).toBe(true);
  });
});

// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ChatPageHeaderRegistration } from '@/features/chat/chat-page-header-registration';
import { usePageHeaderStore } from '@/stores/page-header-store';

const emptyHeader = {
  startExtra: null,
  main: null,
  end: null,
};

describe('ChatPageHeaderRegistration', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    window.matchMedia ??= () => ({
      matches: false,
      media: '',
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    });
    usePageHeaderStore.setState(emptyHeader);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    usePageHeaderStore.setState(emptyHeader);
  });

  it('does not clear the shell header while replacing chat session details', () => {
    const states: boolean[] = [];
    const unsubscribe = usePageHeaderStore.subscribe((state) => {
      states.push(state.main === null);
    });

    act(() => {
      root.render(
        <MemoryRouter>
          <ChatPageHeaderRegistration
            chatHeadline="New chat"
            chatAgents={[]}
            showChatAgentSelector={false}
            chatAgentId="main"
            onChatAgentChange={() => {}}
            chatAgentDisabled
          />
        </MemoryRouter>,
      );
    });

    states.length = 0;

    act(() => {
      root.render(
        <MemoryRouter>
          <ChatPageHeaderRegistration
            chatHeadline="Project planning"
            chatAgents={[]}
            showChatAgentSelector={false}
            chatAgentId="main"
            onChatAgentChange={() => {}}
            chatAgentDisabled={false}
          />
        </MemoryRouter>,
      );
    });

    unsubscribe();
    expect(states).toEqual([false]);
  });
});

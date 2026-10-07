// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { clearPendingAgentRunForChat, setPendingAgentRun } from '@/features/chat/messages/message-sender';
import { useSidebarSessionAgentRun } from '../use-sidebar-session-agent-run';

const conversationId = 'composer-pending-run-test';

describe('useSidebarSessionAgentRun', () => {
  let root: ReturnType<typeof createRoot> | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(async () => {
    await act(async () => root?.unmount());
    container?.remove();
    clearPendingAgentRunForChat(conversationId);
  });

  it('tracks an active run even when the visible sending flags are false', async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    function Harness() {
      const busy = useSidebarSessionAgentRun(conversationId);
      return <span>{busy ? 'busy' : 'idle'}</span>;
    }

    await act(async () => root?.render(<Harness />));
    expect(container.textContent).toBe('idle');

    await act(async () => setPendingAgentRun(conversationId, 'run-1'));
    expect(container.textContent).toBe('busy');

    await act(async () => clearPendingAgentRunForChat(conversationId));
    expect(container.textContent).toBe('idle');
  });
});

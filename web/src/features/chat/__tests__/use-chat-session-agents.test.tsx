// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

import { useChatSessionAgents } from '@/features/chat/session/use-chat-session-agents';
import { useGatewayStore } from '@/stores/gateway-store';

it('preserves the new conversation project and temporary mode when selecting another agent', async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const previousToken = useGatewayStore.getState().token;
  useGatewayStore.setState({ token: undefined });
  const container = document.createElement('div');
  const root = createRoot(container);
  const navigate = vi.fn();
  let agents!: ReturnType<typeof useChatSessionAgents>;
  function Harness() {
    agents = useChatSessionAgents({
      navigate,
      sessionKeyRef: { current: null },
      sessionKey: null,
      isNewRoute: true,
      locationSearch: '?projectId=project-a&draft=hello',
      locationState: { agentId: 'main', temporary: true, forceNewChat: true },
    });
    return null;
  }
  try {
    await act(async () => root.render(<Harness />));
    await act(async () => agents.onChatAgentChange('reviewer'));
    expect(navigate).toHaveBeenCalledExactlyOnceWith('/chat/new?projectId=project-a&draft=hello', {
      replace: false,
      state: { agentId: 'reviewer', temporary: true, forceNewChat: true },
    });
  } finally {
    await act(async () => root.unmount());
    useGatewayStore.setState({ token: previousToken });
    localStorage.clear();
  }
});

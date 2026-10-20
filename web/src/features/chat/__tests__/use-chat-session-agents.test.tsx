// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { SWRConfig } from 'swr';
import { expect, it, vi } from 'vitest';

import { fetchChatAgents } from '@/features/chat/agent-selection/chat-agents-api';
import { resolveChatSessionAgentContext } from '@/features/chat/session/chat-session-agent-context';
import { readNewSessionPreferences, rememberSelectedAgent } from '@/features/chat/session/new-session-preferences';
import { useChatSessionAgents } from '@/features/chat/session/use-chat-session-agents';
import { useGatewayStore } from '@/stores/gateway-store';

vi.mock('@/features/chat/agent-selection/chat-agents-api', () => ({ fetchChatAgents: vi.fn() }));
vi.mock('@/features/chat/session/chat-session-agent-context', () => ({ resolveChatSessionAgentContext: vi.fn() }));

it.each([undefined, 'coder'])('does not inherit the personal agent when starting a new chat (previous=%s)', async (previousAgent) => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  if (previousAgent) rememberSelectedAgent(previousAgent);
  vi.mocked(fetchChatAgents).mockResolvedValue({ defaultId: 'main', items: [{ id: 'main' }, { id: 'coder' }] });
  vi.mocked(resolveChatSessionAgentContext).mockResolvedValue({ agentId: 'personal-owner', projectId: null });
  const previousToken = useGatewayStore.getState().conversationId;
  useGatewayStore.setState({ conversationId: 'token' });
  const root = createRoot(document.createElement('div'));
  const navigate = vi.fn();
  const conversationIdRef = { current: 'personal-conversation' as string | null };
  let agents!: ReturnType<typeof useChatSessionAgents>;
  function Harness({ personal }: { personal: boolean }) {
    agents = useChatSessionAgents({
      navigate, conversationIdRef, conversationId: personal ? 'personal-conversation' : null,
      isNewRoute: !personal, locationState: null, locationSearch: '', personal,
    });
    return null;
  }
  const cache = new Map();
  const config = { provider: () => cache, dedupingInterval: 0 };
  try {
    await act(async () => root.render(<SWRConfig value={config}><Harness personal /></SWRConfig>));
    expect(agents.displayAgentId).toBe('personal-owner');
    expect(agents.resolveAgentIdForPost()).toBe('personal-owner');
    expect(readNewSessionPreferences().selectedAgentId).toBe(previousAgent);

    conversationIdRef.current = null;
    await act(async () => root.render(<SWRConfig value={config}><Harness personal={false} /></SWRConfig>));
    expect(agents.displayAgentId).toBe(previousAgent ?? 'main');
    expect(agents.resolveAgentIdForPost()).toBe(previousAgent ?? 'main');
  } finally {
    await act(async () => root.unmount());
    useGatewayStore.setState({ conversationId: previousToken });
    localStorage.clear();
  }
});

it('preserves the new conversation project and temporary mode when selecting another agent', async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const previousToken = useGatewayStore.getState().conversationId;
  useGatewayStore.setState({ conversationId: undefined });
  const container = document.createElement('div');
  const root = createRoot(container);
  const navigate = vi.fn();
  let agents!: ReturnType<typeof useChatSessionAgents>;
  function Harness() {
    agents = useChatSessionAgents({
      navigate,
      conversationIdRef: { current: null },
      conversationId: null,
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
    useGatewayStore.setState({ conversationId: previousToken });
    localStorage.clear();
  }
});

it('marks an agent switch from an existing conversation as a forced new chat', async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const previousToken = useGatewayStore.getState().conversationId;
  useGatewayStore.setState({ conversationId: undefined });
  const container = document.createElement('div');
  const root = createRoot(container);
  const navigate = vi.fn();
  let agents!: ReturnType<typeof useChatSessionAgents>;
  function Harness() {
    agents = useChatSessionAgents({
      navigate,
      conversationIdRef: { current: 'session-main' },
      conversationId: 'session-main',
      isNewRoute: false,
      locationSearch: '',
      locationState: null,
    });
    return null;
  }
  try {
    await act(async () => root.render(<Harness />));
    await act(async () => agents.onChatAgentChange('reviewer'));
    expect(navigate).toHaveBeenCalledExactlyOnceWith('/chat/new?projectScope=none', {
      replace: false,
      state: { agentId: 'reviewer', forceNewChat: true },
    });
  } finally {
    await act(async () => root.unmount());
    useGatewayStore.setState({ conversationId: previousToken });
    localStorage.clear();
  }
});

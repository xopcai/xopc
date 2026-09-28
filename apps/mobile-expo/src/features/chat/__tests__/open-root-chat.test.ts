import { beforeEach, describe, expect, it, vi } from 'vitest';

const stores = vi.hoisted(() => ({
  closePanel: vi.fn(),
  select: vi.fn(),
}));

vi.mock('../../../stores/gateway-store', () => ({
  useGatewayStore: { getState: () => ({ activeGatewayId: 'gateway-1' }) },
}));
vi.mock('../../navigation/chat-chrome-store', () => ({
  useChatChromeStore: { getState: () => ({ setActionPanelOpen: stores.closePanel }) },
}));
vi.mock('../chat-selection-store', () => ({
  useChatSelectionStore: { getState: () => ({ select: stores.select }) },
}));

import { openRootChat } from '../open-root-chat';

describe('openRootChat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('selects the conversation and activates the existing Assistant tab', () => {
    const router = {
      navigate: vi.fn(),
      dismissTo: vi.fn(),
    };

    expect(openRootChat(router as never, 'conversation-1')).toBe(true);
    expect(stores.select).toHaveBeenCalledWith('gateway-1', 'conversation-1');
    expect(stores.closePanel).toHaveBeenCalledWith(false);
    expect(router.navigate).toHaveBeenCalledWith('/');
    expect(router.dismissTo).not.toHaveBeenCalled();
  });
});

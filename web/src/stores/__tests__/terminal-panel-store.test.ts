import { beforeEach, describe, expect, it } from 'vitest';

import {
  TERMINAL_HEIGHT_MAX,
  TERMINAL_HEIGHT_MIN,
  clampTerminalHeight,
  selectTerminalTabs,
  useTerminalPanelStore,
} from '@/stores/terminal-panel-store';

describe('terminal panel store', () => {
  beforeEach(() => {
    useTerminalPanelStore.setState({
      openByConversationId: {},
      tabsByConversationId: {},
      activeTabKeyByConversationId: {},
      height: 300,
    });
  });

  it('tracks panel visibility per session', () => {
    useTerminalPanelStore.getState().toggle('session-a');
    expect(useTerminalPanelStore.getState().openByConversationId).toEqual({ 'session-a': true });
    expect(useTerminalPanelStore.getState().tabsByConversationId['session-a']).toHaveLength(1);

    useTerminalPanelStore.getState().close('session-a');
    expect(useTerminalPanelStore.getState().openByConversationId['session-a']).toBe(false);
  });

  it('opens a panel idempotently and provisions its first terminal', () => {
    useTerminalPanelStore.getState().open('session-a');
    const firstKey = useTerminalPanelStore.getState().activeTabKeyByConversationId['session-a'];
    useTerminalPanelStore.getState().open('session-a');

    expect(useTerminalPanelStore.getState().openByConversationId['session-a']).toBe(true);
    expect(useTerminalPanelStore.getState().tabsByConversationId['session-a']).toEqual([{ key: firstKey }]);
  });

  it('returns a stable empty tab snapshot for sessions without terminals', () => {
    const tabsByConversationId = useTerminalPanelStore.getState().tabsByConversationId;

    expect(selectTerminalTabs(tabsByConversationId, 'missing-a')).toBe(
      selectTerminalTabs(tabsByConversationId, 'missing-a'),
    );
    expect(selectTerminalTabs(tabsByConversationId, 'missing-a')).toBe(
      selectTerminalTabs(tabsByConversationId, 'missing-b'),
    );
  });

  it('adds, switches, and closes independent terminal tabs', () => {
    useTerminalPanelStore.getState().toggle('session-a');
    const first = useTerminalPanelStore.getState().activeTabKeyByConversationId['session-a']!;
    const second = useTerminalPanelStore.getState().addTerminal('session-a');

    expect(second).not.toBe(first);
    expect(useTerminalPanelStore.getState().tabsByConversationId['session-a']).toHaveLength(2);
    expect(useTerminalPanelStore.getState().activeTabKeyByConversationId['session-a']).toBe(second);

    useTerminalPanelStore.getState().setActiveTerminal('session-a', first);
    expect(useTerminalPanelStore.getState().activeTabKeyByConversationId['session-a']).toBe(first);

    useTerminalPanelStore.getState().closeTerminal('session-a', first);
    expect(useTerminalPanelStore.getState().tabsByConversationId['session-a']).toEqual([{ key: second }]);
    expect(useTerminalPanelStore.getState().activeTabKeyByConversationId['session-a']).toBe(second);
  });

  it('keeps the panel open when its final terminal tab is closed', () => {
    useTerminalPanelStore.getState().toggle('session-a');
    const terminalKey = useTerminalPanelStore.getState().activeTabKeyByConversationId['session-a']!;

    useTerminalPanelStore.getState().closeTerminal('session-a', terminalKey);

    expect(useTerminalPanelStore.getState().tabsByConversationId['session-a']).toEqual([]);
    expect(useTerminalPanelStore.getState().activeTabKeyByConversationId['session-a']).toBeUndefined();
    expect(useTerminalPanelStore.getState().openByConversationId['session-a']).toBe(true);
  });

  it('clamps panel height', () => {
    expect(clampTerminalHeight(0)).toBe(TERMINAL_HEIGHT_MIN);
    expect(clampTerminalHeight(TERMINAL_HEIGHT_MAX + 100)).toBeLessThanOrEqual(TERMINAL_HEIGHT_MAX);
  });
});

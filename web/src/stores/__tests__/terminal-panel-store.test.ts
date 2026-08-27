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
      openBySessionKey: {},
      approvedSessionIds: {},
      tabsBySessionKey: {},
      activeTabKeyBySessionKey: {},
      height: 300,
    });
  });

  it('tracks panel visibility per session', () => {
    useTerminalPanelStore.getState().toggle('session-a');
    expect(useTerminalPanelStore.getState().openBySessionKey).toEqual({ 'session-a': true });
    expect(useTerminalPanelStore.getState().tabsBySessionKey['session-a']).toHaveLength(1);

    useTerminalPanelStore.getState().close('session-a');
    expect(useTerminalPanelStore.getState().openBySessionKey['session-a']).toBe(false);
  });

  it('returns a stable empty tab snapshot for sessions without terminals', () => {
    const tabsBySessionKey = useTerminalPanelStore.getState().tabsBySessionKey;

    expect(selectTerminalTabs(tabsBySessionKey, 'missing-a')).toBe(
      selectTerminalTabs(tabsBySessionKey, 'missing-a'),
    );
    expect(selectTerminalTabs(tabsBySessionKey, 'missing-a')).toBe(
      selectTerminalTabs(tabsBySessionKey, 'missing-b'),
    );
  });

  it('adds, switches, and closes independent terminal tabs', () => {
    useTerminalPanelStore.getState().toggle('session-a');
    const first = useTerminalPanelStore.getState().activeTabKeyBySessionKey['session-a']!;
    const second = useTerminalPanelStore.getState().addTerminal('session-a');

    expect(second).not.toBe(first);
    expect(useTerminalPanelStore.getState().tabsBySessionKey['session-a']).toHaveLength(2);
    expect(useTerminalPanelStore.getState().activeTabKeyBySessionKey['session-a']).toBe(second);

    useTerminalPanelStore.getState().setActiveTerminal('session-a', first);
    expect(useTerminalPanelStore.getState().activeTabKeyBySessionKey['session-a']).toBe(first);

    useTerminalPanelStore.getState().closeTerminal('session-a', first);
    expect(useTerminalPanelStore.getState().tabsBySessionKey['session-a']).toEqual([{ key: second }]);
    expect(useTerminalPanelStore.getState().activeTabKeyBySessionKey['session-a']).toBe(second);
  });

  it('keeps the panel open when its final terminal tab is closed', () => {
    useTerminalPanelStore.getState().toggle('session-a');
    const terminalKey = useTerminalPanelStore.getState().activeTabKeyBySessionKey['session-a']!;

    useTerminalPanelStore.getState().closeTerminal('session-a', terminalKey);

    expect(useTerminalPanelStore.getState().tabsBySessionKey['session-a']).toEqual([]);
    expect(useTerminalPanelStore.getState().activeTabKeyBySessionKey['session-a']).toBeUndefined();
    expect(useTerminalPanelStore.getState().openBySessionKey['session-a']).toBe(true);
  });

  it('tracks approval per concrete session id', () => {
    useTerminalPanelStore.getState().approve('id-a');
    expect(useTerminalPanelStore.getState().approvedSessionIds).toEqual({ 'id-a': true });
  });

  it('clamps panel height', () => {
    expect(clampTerminalHeight(0)).toBe(TERMINAL_HEIGHT_MIN);
    expect(clampTerminalHeight(TERMINAL_HEIGHT_MAX + 100)).toBeLessThanOrEqual(TERMINAL_HEIGHT_MAX);
  });
});

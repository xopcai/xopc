import { beforeEach, describe, expect, it } from 'vitest';

import {
  TERMINAL_HEIGHT_MAX,
  TERMINAL_HEIGHT_MIN,
  clampTerminalHeight,
  useTerminalPanelStore,
} from '@/stores/terminal-panel-store';

describe('terminal panel store', () => {
  beforeEach(() => {
    useTerminalPanelStore.setState({
      openBySessionKey: {},
      approvedSessionIds: {},
      height: 300,
    });
  });

  it('tracks panel visibility per session', () => {
    useTerminalPanelStore.getState().toggle('session-a');
    expect(useTerminalPanelStore.getState().openBySessionKey).toEqual({ 'session-a': true });

    useTerminalPanelStore.getState().close('session-a');
    expect(useTerminalPanelStore.getState().openBySessionKey['session-a']).toBe(false);
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

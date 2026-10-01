import { describe, expect, it } from 'vitest';
import { getComputerMessages } from '../messages.js';
import { getElectronMenuMessages } from '../../i18n.js';

describe('computer desktop copy', () => {
  it('keeps the emergency stop available in localized tray menus', () => {
    expect(getElectronMenuMessages('zh').tray.stopComputer).toBe('停止桌面操作 · Ctrl+Alt+Esc');
    expect(getElectronMenuMessages('en').tray.stopComputer).toBe('Stop desktop control · Ctrl+Alt+Esc');
  });

  it('retains only device re-enrollment and generic endpoint copy', () => {
    expect(JSON.stringify(getComputerMessages('en'))).not.toMatch(/[\u4e00-\u9fff]/);
    expect(getComputerMessages('en').reenroll.detail).toContain('does not grant new app permissions');
    expect(JSON.stringify(getComputerMessages('en'))).not.toContain('Allow this action');
  });
});

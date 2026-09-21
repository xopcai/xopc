import { describe, expect, it } from 'vitest';
import type { ComputerAction } from '@xopcai/computer-control-contract';
import { computerApprovalCopy, describeComputerAction, getComputerMessages } from '../messages.js';
import { getElectronMenuMessages } from '../../i18n.js';

describe('computer dialog copy', () => {
  it('uses the same desktop stop wording in localized tray menus', () => {
    expect(getElectronMenuMessages('zh').tray.stopComputer).toBe('停止桌面操作 · Ctrl+Alt+Esc');
    expect(getElectronMenuMessages('en').tray.stopComputer).toBe('Stop desktop control · Ctrl+Alt+Esc');
  });
  it('keeps English UI copy free of Chinese and removes bilingual button labels', () => {
    expect(JSON.stringify(getComputerMessages('en'))).not.toMatch(/[\u4e00-\u9fff]/);
    for (const lang of ['zh', 'en'] as const) expect(getComputerMessages(lang).allow).not.toContain(' / ');
  });
  it.each(['zh', 'en'] as const)('preserves recipients and scope in %s session approval', language => {
    const result = computerApprovalCopy(language, { kind: 'session', id: 's', appId: 'com.example.app', appName: 'Example', mode: 'control', prepare: false, model: {
      modelRef: 'provider/gui', origin: 'https://router.example.com', upstreamOrigin: 'https://model.example.com',
      profile: 'structured-tools-v1', runtimeLocation: 'local',
    } });
    expect(result.detail).toContain('Example');
    expect(result.detail).toContain('provider/gui');
    expect(result.detail).toContain('https://router.example.com');
    expect(result.detail).toContain('https://model.example.com');
    expect(result.detail).toContain('15');
    expect(result.detail).toContain(getComputerMessages(language).sessionPrivacy);
  });
  it('omits an absent upstream recipient', () => {
    const result = computerApprovalCopy('en', { kind: 'session', id: 's', appId: 'app', appName: 'Example', mode: 'observe', prepare: true, model: {
      modelRef: 'provider/gui', origin: 'https://model.example.com', profile: 'structured-tools-v1', runtimeLocation: 'local',
    } });
    expect(result.detail).not.toContain('Upstream');
    expect(result.detail).not.toContain('undefined');
    expect(result.message).toBe(getComputerMessages('en').observeTitle);
    expect(result.detail).toContain(getComputerMessages('en').prepare);
  });
  it.each(['zh', 'en'] as const)('keeps exact action parameters in %s readable descriptions', language => {
    const actions: ComputerAction[] = [
      { kind: 'click', point: { x: 125, y: 67 }, button: 'right', count: 2 },
      { kind: 'typeText', point: { x: 125, y: 67 }, text: 'Line 1\n"Line 2"' },
      { kind: 'setValue', ref: 'e12', text: 'Exact value' },
      { kind: 'pressKeys', keys: ['cmd', 'shift', 'a'] },
      { kind: 'scroll', point: { x: 125, y: 67 }, deltaX: -400, deltaY: 0 },
      { kind: 'wait', durationMs: 1200 },
    ];
    const descriptions = actions.map(action => describeComputerAction(language, action));
    const t = getComputerMessages(language).actions;
    expect(descriptions[0]).toContain(`${t.doubleClick} · ${t.right} · (125, 67)`);
    expect(descriptions[1]).toContain(JSON.stringify('Line 1\n"Line 2"'));
    expect(descriptions[2]).toContain('e12');
    expect(descriptions[2]).toContain(JSON.stringify('Exact value'));
    expect(descriptions[3]).toContain('cmd + shift + a');
    expect(descriptions[4]).toContain('-400');
    expect(descriptions[4]).toContain('(125, 67)');
    expect(descriptions[5]).toContain('1200');
    expect(describeComputerAction(language, { kind: 'typeText', text: '' })).toContain(t.focused);
  });
});

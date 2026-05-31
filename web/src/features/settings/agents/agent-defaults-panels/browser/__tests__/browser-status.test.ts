import { describe, expect, it } from 'vitest';

import {
  doctorStatus,
  extensionDoctorStatus,
  selectedBackendStatus,
  statusLabelFor,
} from '@/features/settings/agents/agent-defaults-panels/browser/browser-status';
import type { AgentDefaultsPanelProps } from '@/features/settings/agents/agent-defaults-panel-props';

const labels = {
  browserStatusReady: 'Ready',
  browserStatusNotInstalled: 'Not installed',
  browserStatusChecking: 'Checking',
  browserStatusUnknown: 'Unknown',
  browserStatusError: 'Error',
  browserExtensionConnected: 'Connected',
  browserExtensionWaiting: 'Waiting',
  browserExtensionServerOff: 'Off',
} as Pick<AgentDefaultsPanelProps['a'], 'browserStatusReady' | 'browserStatusNotInstalled' | 'browserStatusChecking' | 'browserStatusUnknown' | 'browserStatusError' | 'browserExtensionConnected' | 'browserExtensionWaiting' | 'browserExtensionServerOff'>;

describe('browser-status helpers', () => {
  it('doctorStatus maps doctor states', () => {
    expect(doctorStatus({ kind: 'loading' })).toBe('checking');
    expect(doctorStatus({ kind: 'error', message: 'x' })).toBe('error');
    expect(doctorStatus({ kind: 'ok', data: { installed: true } })).toBe('ready');
    expect(doctorStatus({ kind: 'ok', data: { installed: false } })).toBe('not_installed');
    expect(doctorStatus({ kind: 'idle' })).toBeUndefined();
  });

  it('extensionDoctorStatus distinguishes connected vs waiting', () => {
    expect(extensionDoctorStatus({ kind: 'ok', data: { running: true, connected: true } })).toBe(
      'ready',
    );
    expect(extensionDoctorStatus({ kind: 'ok', data: { running: true, connected: false } })).toBe(
      'not_installed',
    );
  });

  it('statusLabelFor maps status kinds to labels', () => {
    expect(statusLabelFor('ready', labels as AgentDefaultsPanelProps['a'])).toBe('Ready');
    expect(statusLabelFor(undefined, labels as AgentDefaultsPanelProps['a'])).toBeUndefined();
  });

  it('selectedBackendStatus returns backend-specific status only', () => {
    const a = labels as AgentDefaultsPanelProps['a'];
    expect(
      selectedBackendStatus('cdp', {
        extensionStatus: 'ready',
        extensionStatusLabel: 'Connected',
        localStatus: 'ready',
        cloakStatus: 'not_installed',
        a,
      }),
    ).toEqual({ status: undefined, statusLabel: undefined });

    expect(
      selectedBackendStatus('local', {
        extensionStatus: 'ready',
        extensionStatusLabel: 'Connected',
        localStatus: 'not_installed',
        cloakStatus: undefined,
        a,
      }),
    ).toEqual({ status: 'not_installed', statusLabel: 'Not installed' });
  });
});

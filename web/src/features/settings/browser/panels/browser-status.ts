import type { AgentDefaultsPanelProps } from '.././browser-settings-panel-props';

import type { ModeStatusKind } from './backend-mode-card';
import type { useBrowserDoctor } from './use-browser-doctor';

export function doctorStatus<T extends { installed: boolean }>(
  d: { kind: 'idle' } | { kind: 'loading' } | { kind: 'ok'; data: T } | { kind: 'error'; message: string },
): ModeStatusKind | undefined {
  if (d.kind === 'loading') return 'checking';
  if (d.kind === 'error') return 'error';
  if (d.kind === 'ok') return d.data.installed ? 'ready' : 'not_installed';
  return undefined;
}

export function statusLabelFor(
  status: ModeStatusKind | undefined,
  a: AgentDefaultsPanelProps['a'],
): string | undefined {
  if (!status) return undefined;
  return {
    ready: a.browserStatusReady,
    not_installed: a.browserStatusNotInstalled,
    checking: a.browserStatusChecking,
    unknown: a.browserStatusUnknown,
    error: a.browserStatusError,
  }[status];
}

export function extensionDoctorStatus(
  d: ReturnType<typeof useBrowserDoctor>['extension'],
): ModeStatusKind | undefined {
  if (d.kind === 'idle') return undefined;
  if (d.kind === 'loading') return 'checking';
  if (d.kind === 'error') return 'error';
  if (d.data.connected) return 'ready';
  if (d.data.running) return 'not_installed';
  return 'not_installed';
}

export function extensionStatusLabelFor(
  d: ReturnType<typeof useBrowserDoctor>['extension'],
  a: AgentDefaultsPanelProps['a'],
): string | undefined {
  if (d.kind === 'idle') return undefined;
  if (d.kind === 'loading') return a.browserStatusChecking;
  if (d.kind === 'error') return a.browserStatusError;
  if (d.data.connected) return a.browserExtensionConnected;
  if (d.data.running) return a.browserExtensionWaiting;
  return a.browserExtensionServerOff;
}

export function selectedBackendStatus(
  backend: string,
  opts: {
    extensionStatus: ModeStatusKind | undefined;
    extensionStatusLabel: string | undefined;
    localStatus: ModeStatusKind | undefined;
    cloakStatus: ModeStatusKind | undefined;
    a: AgentDefaultsPanelProps['a'];
  },
): { status: ModeStatusKind | undefined; statusLabel: string | undefined } {
  switch (backend) {
    case 'extension':
      return { status: opts.extensionStatus, statusLabel: opts.extensionStatusLabel };
    case 'local':
      return {
        status: opts.localStatus,
        statusLabel: statusLabelFor(opts.localStatus, opts.a),
      };
    case 'cloakbrowser':
      return {
        status: opts.cloakStatus,
        statusLabel: statusLabelFor(opts.cloakStatus, opts.a),
      };
    default:
      return { status: undefined, statusLabel: undefined };
  }
}

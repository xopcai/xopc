// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  NPM_PENDING_RESTART_KEY,
  notifyNpmUpdateInstalled,
} from '../use-update-status';

describe('notifyNpmUpdateInstalled', () => {
  afterEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('starts the gateway recovery flow after an automatic restart is scheduled', () => {
    const installed = vi.fn();
    const restarting = vi.fn();
    window.addEventListener('xopc:npm-update-installed', installed);
    window.addEventListener('gateway-restart-initiated', restarting);

    notifyNpmUpdateInstalled('0.0.287', true);

    expect(JSON.parse(sessionStorage.getItem(NPM_PENDING_RESTART_KEY) ?? '{}')).toEqual({
      installedVersion: '0.0.287',
      automaticRestart: true,
    });
    expect(installed).toHaveBeenCalledOnce();
    expect(restarting).toHaveBeenCalledOnce();

    window.removeEventListener('xopc:npm-update-installed', installed);
    window.removeEventListener('gateway-restart-initiated', restarting);
  });

  it('does not refresh while a manual gateway restart is still required', () => {
    const restarting = vi.fn();
    window.addEventListener('gateway-restart-initiated', restarting);

    notifyNpmUpdateInstalled('0.0.287', false);

    expect(restarting).not.toHaveBeenCalled();

    window.removeEventListener('gateway-restart-initiated', restarting);
  });
});

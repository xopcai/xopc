import { describe, expect, it, beforeEach, vi } from 'vitest';

import * as execModule from '../exec.js';
import {
  resetTailscaleBinaryCacheForTest,
  getTailnetIPv4Sync,
  requireTailscaleBinary,
  TailscaleCliNotFoundError,
} from '../tailscale.js';

describe('tailscale infra', () => {
  beforeEach(() => {
    resetTailscaleBinaryCacheForTest();
    delete process.env.XOPC_TEST_TAILSCALE_BINARY;
    vi.restoreAllMocks();
  });

  it('returns undefined when tailscale is not available', () => {
    process.env.XOPC_TEST_TAILSCALE_BINARY = '/nonexistent/tailscale';
    process.env.VITEST = 'true';
    expect(getTailnetIPv4Sync()).toBeUndefined();
  });

  it('requireTailscaleBinary throws when CLI is missing', async () => {
    vi.spyOn(execModule, 'runExec').mockRejectedValue(new Error('tailscale not available'));
    await expect(requireTailscaleBinary()).rejects.toBeInstanceOf(TailscaleCliNotFoundError);
  });
});

import { describe, expect, it, vi } from 'vitest';

import type { Config } from '@xopcai/xopc/config/index.js';

import { runTelegramDoctorChecks } from '../doctor.js';

function cfg(): Config {
  return {
    channels: {
      telegram: {
        enabled: true,
        accounts: {
          default: {
            enabled: true,
            botToken: '123456789:abcdefghijklmnopqrstuvwxyz',
          },
        },
      },
    },
  } as unknown as Config;
}

describe('runTelegramDoctorChecks', () => {
  it('checks getMe for enabled accounts', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, result: { username: 'xopc_bot' } }), { status: 200 }),
    );

    const results = await runTelegramDoctorChecks({ cfg: cfg(), fetchImpl: fetchMock as unknown as typeof fetch });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/bot123456789:abcdefghijklmnopqrstuvwxyz/getMe');
    expect(results).toContainEqual(
      expect.objectContaining({
        id: 'telegram-account-getme-default',
        status: 'pass',
        message: expect.stringContaining('@xopc_bot'),
      }),
    );
  });

  it('reports getMe network failures with proxy guidance', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });

    const results = await runTelegramDoctorChecks({ cfg: cfg(), fetchImpl: fetchMock as unknown as typeof fetch });
    const getMe = results.find((r) => r.id === 'telegram-account-getme-default');

    expect(getMe).toEqual(
      expect.objectContaining({
        status: 'fail',
        message: expect.stringContaining('fetch failed'),
        hints: expect.arrayContaining([expect.stringContaining('channels.telegram.defaults.proxy')]),
      }),
    );
  });
});

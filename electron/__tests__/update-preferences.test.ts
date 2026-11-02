import { describe, expect, it, vi } from 'vitest';
import { automaticDesktopUpdatesEnabled, DESKTOP_UPDATE_REGISTRY_KEY } from '../update-preferences.js';

describe('installer desktop update consent', () => {
  it('leaves non-Windows behavior unchanged without querying the registry', async () => {
    const query = vi.fn(); expect(await automaticDesktopUpdatesEnabled('darwin', query)).toBe(true); expect(query).not.toHaveBeenCalled();
  });
  it.each(['0x0', '0x2', '', '0x10'])('does not treat %s as consent', async value => {
    expect(await automaticDesktopUpdatesEnabled('win32', vi.fn().mockResolvedValue({ stdout: `AutomaticUpdates REG_DWORD ${value}` }))).toBe(false);
  });
  it('requires the exact DWORD consent and the shared 64-bit installer registry view', async () => {
    const query = vi.fn().mockResolvedValue({ stdout: '  AutomaticUpdates    REG_DWORD    0x1\r\n' });
    expect(await automaticDesktopUpdatesEnabled('win32', query)).toBe(true);
    expect(query.mock.calls[0][1]).toEqual(['query', DESKTOP_UPDATE_REGISTRY_KEY, '/v', 'AutomaticUpdates', '/reg:64']);
  });
  it('fails closed when consent is absent, inaccessible or malformed', async () => {
    expect(await automaticDesktopUpdatesEnabled('win32', vi.fn().mockRejectedValue(new Error('access denied')))).toBe(false);
  });
});

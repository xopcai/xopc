import { afterEach, describe, expect, it, vi } from 'vitest';
import { WEB_LOCATION_TOOL } from '../location-tool';
const context = (signal = new AbortController().signal) => ({ invocationId: 'once', signal, reportProgress: () => {}, uploadFile: vi.fn() });
afterEach(() => vi.unstubAllGlobals());
describe('browser one-shot location', () => {
  it('coarsens approximate coordinates before upload and prohibits cached samples', async () => {
    const getCurrentPosition = vi.fn((success: any, _failure: any, _options: PositionOptions) => success({ timestamp: Date.now(), coords: { latitude: 31.234567, longitude: 121.456789, accuracy: 8 } }));
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } });
    const result = await WEB_LOCATION_TOOL.execute({ purpose: 'weather', precision: 'approximate' }, context());
    expect(result.content).toMatchObject([{ value: { latitude: 31.24, longitude: 121.46, precision: 'approximate', accuracyMeters: 3000 } }]);
    expect(getCurrentPosition.mock.calls[0][2]).toEqual({ maximumAge: 0, timeout: 20000, enableHighAccuracy: false });
  });
  it('drops late samples after cancellation and never passes OS error messages upstream', async () => {
    let success: any; let failure: any;
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition: (yes: any, no: any) => { success = yes; failure = no; } } });
    const controller = new AbortController();
    const cancelled = WEB_LOCATION_TOOL.execute({ purpose: 'weather', precision: 'precise' }, context(controller.signal));
    controller.abort(); await expect(cancelled).rejects.toMatchObject({ code: 'TOOL_CANCELLED' });
    success({ timestamp: Date.now(), coords: { latitude: 1, longitude: 2, accuracy: 1 } });
    const denied = WEB_LOCATION_TOOL.execute({ purpose: 'weather', precision: 'precise' }, context());
    failure({ code: 1, message: 'private coordinates: 1,2' });
    await expect(denied).rejects.toMatchObject({ code: 'PERMISSION_DENIED', message: 'Location permission denied' });
  });
  it('does not sample malformed or already-cancelled requests', async () => {
    const getCurrentPosition = vi.fn(); vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } });
    await expect(WEB_LOCATION_TOOL.execute({ purpose: 'nearby', precision: 'precise' }, context())).rejects.toThrow();
    const controller = new AbortController(); controller.abort();
    await expect(WEB_LOCATION_TOOL.execute({ purpose: 'weather', precision: 'approximate' }, context(controller.signal))).rejects.toMatchObject({ code: 'TOOL_CANCELLED' });
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from 'vitest';
import { processLocationTask } from '../location-task.js';

const reading = { latitude: 31.234567, longitude: 121.456789, capturedAt: 100_000, accuracyMeters: 8, precision: 'precise', coordinateSystem: 'WGS84' };
const content = [{ type: 'json' as const, value: reading }];
const source = { endpointId: 'phone', principalId: 'principal' };
const args = { purpose: 'weather', precision: 'approximate' };
describe('transient location task projection', () => {
  it('quantizes approximate requests before external disclosure and returns no raw position or provider extras', async () => {
    const request = vi.fn(async () => Response.json({ latitude: 31.234567, longitude: 121.456789, current: { temperature_2m: 24, relative_humidity_2m: 45, weather_code: 0, wind_speed_10m: 5 }, privateField: reading }));
    const result = await processLocationTask(args, content, source, undefined, request as typeof fetch, () => 100_000);
    const url = request.mock.calls[0][0] as URL;
    expect(url.searchParams.get('latitude')).toBe('31.24'); expect(url.searchParams.get('longitude')).toBe('121.46');
    expect(result).toMatchObject({ source, precision: 'approximate', accuracyMeters: 3000, retention: 'summary', data: { temperatureCelsius: 24 } });
    expect(JSON.stringify(result)).not.toMatch(/latitude|longitude|31\.234567|121\.456789|privateField/);
  });
  it('validates purpose, precision, coordinates and freshness before calling a provider', async () => {
    const request = vi.fn();
    for (const [input, value] of [[{ ...args, category: 'cafe' }, reading], [args, { ...reading, latitude: 91 }], [args, { ...reading, capturedAt: 1 }], [{ ...args, extra: true }, reading]]) {
      await expect(processLocationTask(input as typeof args, [{ type: 'json', value }], source, undefined, request, () => 100_000)).rejects.toThrow();
    }
    expect(request).not.toHaveBeenCalled();
  });
  it('retains only named places from the approved category and does not persist provider geometry or identifiers', async () => {
    const request = vi.fn(async () => Response.json({ elements: [{ id: 99, lat: reading.latitude, lon: reading.longitude, tags: { name: 'Cafe', 'addr:street': 'Road', phone: 'private' } }] }));
    const result = await processLocationTask({ purpose: 'nearby', precision: 'precise', category: 'cafe' }, content, source, undefined, request as typeof fetch, () => 100_000);
    expect(result.data).toMatchObject({ category: 'cafe', places: [{ name: 'Cafe', street: 'Road' }] });
    expect(JSON.stringify(result)).not.toMatch(/31\.234567|121\.456789|"phone":|geometry/);
  });
  it('does not leak coordinates or URLs from failure messages and respects cancellation', async () => {
    const request = vi.fn(async () => { throw new Error('Fetch failed latitude=31.234567'); });
    await expect(processLocationTask(args, content, source, undefined, request, () => 100_000)).rejects.toThrow('Location lookup service is unavailable');
    const controller = new AbortController(); controller.abort();
    await expect(processLocationTask(args, content, source, controller.signal, request, () => 100_000)).rejects.toThrow('cancelled');
  });
});

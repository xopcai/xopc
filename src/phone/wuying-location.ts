import { setTimeout as delay } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import type { LocationSample } from '@xopcai/endpoint-tools-protocol';

import { PhoneError } from './contracts.js';

export type LocationCommand = (args: string[], signal: AbortSignal) => Promise<string>;
export interface WuyingLocationBaseline { property: string; fingerprint: string; order: 'latitude-first' | 'longitude-first' }
const propertyName = 'persist.location.data';
const numeric = '-?\\d+(?:\\.\\d+)?';
function tuple(raw: string): [number, number, number] {
  if (!new RegExp(`^${numeric},${numeric},${numeric},wgs$`).test(raw) || raw.length > 160) throw new PhoneError('PHONE_ENV_UNSUPPORTED', 'Cloud phone location format is unsupported', 409);
  const values = raw.split(',').slice(0, 3).map(Number);
  if (values.some(value => !Number.isFinite(value))) throw new PhoneError('PHONE_ENV_UNSUPPORTED', 'Cloud phone location format is unsupported', 409);
  return values as [number, number, number];
}
function fixes(dump: string) {
  return [...dump.matchAll(/^\s*last location=Location\[gps\s+(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/gm)]
    .map(match => ({ latitude: Number(match[1]), longitude: Number(match[2]) }));
}
// The virtual GPS adds a few metres of jitter to the configured property.
const matches = (fix: {latitude: number; longitude: number}, latitude: number, longitude: number) =>
  Math.hypot(fix.latitude - latitude, (fix.longitude - longitude) * Math.cos(latitude * Math.PI / 180)) * 111_320 <= 15;

/** Detect the installed image's property layout from an actual GPS fix; never guess tuple order. */
export class WuyingLocationAdapter {
  constructor(private readonly command: LocationCommand) {}
  private async read(args: string[], signal: AbortSignal) {
    const output = await this.command(args, signal);
    if (/Exception|Permission denied|Error:|Failed to set/i.test(output)) throw new PhoneError('PHONE_ENV_OPERATION_FAILED', 'Cloud phone location command failed', 502);
    return output.trim();
  }
  private async fingerprint(signal: AbortSignal) {
    return createHash('sha256').update(await this.read(['getprop', 'ro.build.fingerprint'], signal)).digest('hex');
  }
  async prepare(signal: AbortSignal): Promise<WuyingLocationBaseline> {
    if (Number(await this.read(['getprop', 'ro.build.version.sdk'], signal)) < 31) throw new PhoneError('PHONE_ENV_UNSUPPORTED', 'This cloud phone image is unsupported', 409);
    const property = await this.read(['getprop', propertyName], signal);
    const [first, second] = tuple(property);
    const dump = await this.read(['dumpsys', 'location'], signal);
    const current = fixes(dump);
    const latitudeFirst = Math.abs(first) <= 90 && Math.abs(second) <= 180 && current.some(fix => matches(fix, first, second));
    const longitudeFirst = Math.abs(first) <= 180 && Math.abs(second) <= 90 && current.some(fix => matches(fix, second, first));
    if (latitudeFirst === longitudeFirst) throw new PhoneError('PHONE_ENV_UNSUPPORTED', 'A current GPS fix is required to verify cloud phone coordinate order', 409);
    return { property, fingerprint: await this.fingerprint(signal), order: latitudeFirst ? 'latitude-first' : 'longitude-first' };
  }
  private async verify(raw: string, baseline: WuyingLocationBaseline, signal: AbortSignal) {
    const [first, second] = tuple(raw);
    const latitude = baseline.order === 'latitude-first' ? first : second;
    const longitude = baseline.order === 'latitude-first' ? second : first;
    for (let attempt = 0; attempt < 12; attempt++) {
      signal.throwIfAborted();
      const property = await this.read(['getprop', propertyName], signal);
      const current = fixes(await this.read(['dumpsys', 'location'], signal));
      if (property === raw && current.length && current.every(fix => matches(fix, latitude, longitude))) return;
      await delay(500, undefined, { signal });
    }
    throw new PhoneError('PHONE_ENV_UNVERIFIED', 'Cloud phone GPS has not confirmed the requested location', 409);
  }
  async apply(sample: LocationSample, baseline: WuyingLocationBaseline, assertCurrent: () => void, signal: AbortSignal) {
    const [, , altitude] = tuple(baseline.property);
    const [first, second] = baseline.order === 'latitude-first' ? [sample.latitude, sample.longitude] : [sample.longitude, sample.latitude];
    const raw = `${first.toFixed(7)},${second.toFixed(7)},${altitude},wgs`;
    if (await this.fingerprint(signal) !== baseline.fingerprint) throw new PhoneError('PHONE_ENV_UNSUPPORTED', 'Cloud phone image changed', 409);
    assertCurrent();
    await this.read(['setprop', propertyName, raw], signal);
    await this.verify(raw, baseline, signal);
    assertCurrent();
  }
  async restore(baseline: WuyingLocationBaseline, signal: AbortSignal) {
    tuple(baseline.property);
    if (await this.fingerprint(signal) !== baseline.fingerprint) throw new PhoneError('PHONE_ENV_CLEANUP_PENDING', 'Cloud phone image changed; location cleanup needs inspection', 409);
    await this.read(['setprop', propertyName, baseline.property], signal);
    await this.verify(baseline.property, baseline, signal);
  }
}

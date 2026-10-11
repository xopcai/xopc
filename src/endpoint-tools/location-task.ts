import { locationRequestSchema, locationSampleSchema, type EndpointToolContent } from '@xopcai/endpoint-tools-protocol';

const WEATHER_URL = 'https://api.open-meteo.com/v1/forecast';
const PLACES_URL = 'https://overpass-api.de/api/interpreter';
const CATEGORY_FILTER = { restaurant: 'amenity=restaurant', cafe: 'amenity=cafe', pharmacy: 'amenity=pharmacy', park: 'leisure=park' };

/** Sensitive samples never leave this processor as model, stream or persistence content. */
export async function processLocationTask(args: Record<string, unknown>, content: EndpointToolContent[],
  source: { endpointId: string; principalId: string }, signal?: AbortSignal, request = fetch, now = Date.now) {
  const input = locationRequestSchema.parse(args);
  if (content.length !== 1 || content[0].type !== 'json') throw new Error('Invalid location sample');
  const sample = locationSampleSchema.parse(content[0].value);
  if (sample.capturedAt < now() - 30_000 || sample.capturedAt > now() + 60_000) throw new Error('Location sample expired or has an invalid clock');
  const approximate = input.precision === 'approximate' || sample.precision === 'approximate';
  const latitude = approximate ? Math.round(sample.latitude * 50) / 50 : sample.latitude;
  const longitude = approximate ? Math.round(sample.longitude * 50) / 50 : sample.longitude;
  const scopedSignal = AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(15_000)]);
  const readResponse = async (response: Response) => {
    if (!response.ok || response.redirected) throw new Error('Location lookup service is unavailable');
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Location lookup service returned no data');
    let bytes = 0; const chunks: Uint8Array[] = [];
    try { while (true) { const part = await reader.read(); if (part.done) break;
      bytes += part.value.length; if (bytes > 512_000) throw new Error('Location lookup response is too large'); chunks.push(part.value); } }
    finally { await reader.cancel().catch(() => {}); }
    const joined = new Uint8Array(bytes); let offset = 0;
    for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.length; }
    return JSON.parse(new TextDecoder().decode(joined));
  };
  let data: Record<string, unknown>;
  try {
    scopedSignal.throwIfAborted();
    if (input.purpose === 'weather') {
      const url = new URL(WEATHER_URL); url.searchParams.set('latitude', String(latitude)); url.searchParams.set('longitude', String(longitude));
      url.searchParams.set('current', 'temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m');
      const response = await readResponse(await request(url, { signal: scopedSignal, redirect: 'error' }));
      const current = response.current ?? {};
      if (typeof current.temperature_2m !== 'number' || !Number.isFinite(current.temperature_2m)) throw new Error('Invalid weather response');
      const numeric = (key: string, min: number, max: number) => typeof current[key] === 'number' && Number.isFinite(current[key])
        && current[key] >= min && current[key] <= max ? current[key] : null;
      data = { provider: 'Open-Meteo', sourceUrl: 'https://open-meteo.com/',
        temperatureCelsius: numeric('temperature_2m', -100, 100), humidityPercent: numeric('relative_humidity_2m', 0, 100),
        weatherCode: numeric('weather_code', 0, 99), windSpeedKmh: numeric('wind_speed_10m', 0, 500) };
    } else {
      const query = `[out:json][timeout:10];nwr(around:2000,${latitude},${longitude})[${CATEGORY_FILTER[input.category!]}];out tags 10;`;
      const response = await readResponse(await request(PLACES_URL, { method: 'POST', signal: scopedSignal, redirect: 'error',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ data: query }) }));
      if (!Array.isArray(response.elements)) throw new Error('Invalid nearby service result');
      const text = (value: unknown) => typeof value === 'string' ? value.slice(0, 160)
        .replaceAll(String(sample.latitude), '[location]').replaceAll(String(sample.longitude), '[location]') : '';
      data = { provider: 'OpenStreetMap', sourceUrl: 'https://www.openstreetmap.org/', category: input.category,
        radiusMeters: 2000, places: response.elements.slice(0, 10).map((element: { tags?: Record<string, unknown> }) => ({
          name: text(element.tags?.name), street: text(element.tags?.['addr:street']), houseNumber: text(element.tags?.['addr:housenumber']),
        })).filter((place: { name: string }) => place.name.length > 0) };
    }
  } catch { throw new Error(scopedSignal.aborted ? 'Location lookup cancelled or timed out' : 'Location lookup service is unavailable'); }
  scopedSignal.throwIfAborted();
  if (sample.capturedAt < now() - 30_000) throw new Error('Location sample expired during lookup');
  return { version: 1, source, capturedAt: sample.capturedAt, receivedAt: now(),
    validUntil: Math.min(sample.capturedAt, now()) + 30_000, cached: false, retention: 'summary',
    purpose: input.purpose, precision: approximate ? 'approximate' : 'precise',
    accuracyMeters: approximate ? Math.max(3000, sample.accuracyMeters) : sample.accuracyMeters,
    status: 'ok', data };
}

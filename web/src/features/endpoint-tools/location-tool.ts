import { EndpointToolClientError, type EndpointToolDefinition } from '@xopcai/endpoint-tools-client';
import { locationDescriptor, locationRequestSchema } from '@xopcai/endpoint-tools-protocol';

export const WEB_LOCATION_TOOL: EndpointToolDefinition = {
  descriptor: locationDescriptor('web'),
  async execute(args, context) {
    const input = locationRequestSchema.parse(args);
    if (!navigator.geolocation) throw new EndpointToolClientError('PERMISSION_DENIED', 'Location is unavailable in this browser');
    const value = await new Promise<Record<string, unknown>>((resolve, reject) => {
      let done = false;
      const finish = (result?: GeolocationPosition, error?: Error) => {
        if (done) return; done = true; context.signal.removeEventListener('abort', cancel);
        if (error) { reject(error); return; }
        const approximate = input.precision === 'approximate' || result!.coords.accuracy > 1000;
        resolve({ capturedAt: result!.timestamp, latitude: approximate ? Math.round(result!.coords.latitude * 50) / 50 : result!.coords.latitude, longitude: approximate ? Math.round(result!.coords.longitude * 50) / 50 : result!.coords.longitude,
          accuracyMeters: approximate ? Math.max(3000, result!.coords.accuracy) : result!.coords.accuracy, coordinateSystem: 'WGS84',
          precision: approximate ? 'approximate' : 'precise' });
      };
      const cancel = () => finish(undefined, new EndpointToolClientError('TOOL_CANCELLED', 'Location request cancelled'));
      context.signal.addEventListener('abort', cancel, { once: true });
      if (context.signal.aborted) { cancel(); return; }
      navigator.geolocation.getCurrentPosition(position => finish(position), error => finish(undefined,
        new EndpointToolClientError(error.code === 1 ? 'PERMISSION_DENIED' : error.code === 3 ? 'TOOL_TIMEOUT' : 'PROTOCOL_ERROR',
          error.code === 1 ? 'Location permission denied' : 'Location is unavailable')),
      { maximumAge: 0, timeout: 20_000, enableHighAccuracy: input.precision === 'precise' });
    });
    return { content: [{ type: 'json', value }] };
  },
};

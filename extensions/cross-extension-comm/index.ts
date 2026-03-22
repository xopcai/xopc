/**
 * Cross-Extension Communication - Phase 3 TypedEventBus Example
 *
 * Demonstrates: Event bus for inter-extension communication (RPC pattern)
 *
 * Usage: xopcbot extension install ./examples/extensions/cross-extension-comm
 */

import type { ExtensionApi } from 'xopcbot/extension-sdk';

// Mock weather data
const weatherData: Record<string, { temp: number; humidity: number }> = {
  Beijing: { temp: 25, humidity: 60 },
  Shanghai: { temp: 28, humidity: 75 },
  'New York': { temp: 15, humidity: 50 },
};

export default function(api: ExtensionApi) {
  api.logger.info('Weather Service extension registered!');

  // Request-Response Pattern (RPC)
  api.events.onRequest('weather:get', async (params: { city: string }) => {
    const city = params.city;
    const data = weatherData[city];

    if (!data) {
      throw new Error(`Weather data not found for: ${city}`);
    }

    api.logger.debug(`Weather request for ${city}: ${data.temp}°C`);
    return { temp: data.temp, humidity: data.humidity, condition: 'Sunny' };
  });

  // Event Broadcasting: Periodic weather updates
  const updateInterval = setInterval(() => {
    api.events.emit('weather:updated', {
      city: 'Beijing',
      temp: weatherData['Beijing'].temp,
      humidity: weatherData['Beijing'].humidity,
      timestamp: Date.now(),
    });
  }, 60000); // Every minute

  // Cleanup on extension unload
  api.registerHook('session_end', () => {
    clearInterval(updateInterval);
    api.events.cleanup('cross-extension-comm');
  });
}

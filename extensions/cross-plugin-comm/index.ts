/**
 * Cross-Plugin Communication - Phase 3 TypedEventBus Example
 *
 * Demonstrates: Event bus for inter-plugin communication (RPC pattern)
 *
 * Usage: xopcbot plugin install ./examples/plugins/cross-plugin-comm
 */

import type { PluginApi } from 'xopcbot/plugin-sdk';

// Mock weather data
const weatherData: Record<string, { temp: number; humidity: number }> = {
  Beijing: { temp: 25, humidity: 60 },
  Shanghai: { temp: 28, humidity: 75 },
  'New York': { temp: 15, humidity: 50 },
};

export default function(api: PluginApi) {
  api.logger.info('Weather Service plugin registered!');

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

  // Cleanup on plugin unload
  api.registerHook('session_end', () => {
    clearInterval(updateInterval);
    api.events.cleanup('cross-plugin-comm');
  });
}

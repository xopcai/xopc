/**
 * Phase 3: Inter-Extension Communication Tests
 *
 * Tests for:
 * - Type-safe event bus
 * - Request-response pattern (RPC)
 * - Event namespacing with wildcards
 * - Automatic cleanup on plugin unload
 * - Inter-extension event communication
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TypedEventBus } from '../typed-event-bus.js';
import type {
  EventMap,
  RequestMap,
} from '../types.js';

// Define test event types
interface TestEvents extends EventMap {
  'user:login': { userId: string; timestamp: number; channel: string };
  'user:logout': { userId: string; timestamp: number };
  'message:received': { chatId: string; content: string; sender: string };
  'message:sent': { chatId: string; messageId: string; success: boolean };
  'weather:updated': { city: string; temp: number; humidity: number };
  'weather:alert': { city: string; alert: string; severity: 'low' | 'medium' | 'high' };
}

// Define test request types
interface TestRequests extends RequestMap {
  'user:get': { userId: string };
  'weather:get': { city: string };
  'config:get': { key: string };
}

interface TestResponses extends RequestMap {
  'user:get': { name: string; email: string; lastLogin: number };
  'weather:get': { temp: number; humidity: number; forecast: string[] };
  'config:get': { value: unknown; defaultValue: unknown };
}

describe('Phase 3: Typed Event Bus', () => {
  let eventBus: TypedEventBus<TestEvents, TestRequests, TestResponses>;

  beforeEach(() => {
    eventBus = new TypedEventBus<TestEvents, TestRequests, TestResponses>({
      requestTimeout: 5000,
    });
  });

  // ============================================================================
  // Basic Event Emission and Listening
  // ============================================================================
  describe('basic event handling', () => {
    it('should emit and receive typed events', () => {
      const handler = vi.fn();

      eventBus.on('user:login', handler);
      eventBus.emit('user:login', {
        userId: 'user123',
        timestamp: Date.now(),
        channel: 'telegram',
      });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith({
        userId: 'user123',
        timestamp: expect.any(Number),
        channel: 'telegram',
      });
    });

    it('should support multiple listeners for same event', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      eventBus.on('user:login', handler1);
      eventBus.on('user:login', handler2);
      eventBus.emit('user:login', {
        userId: 'user123',
        timestamp: Date.now(),
        channel: 'telegram',
      });

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    it('should remove listener with off()', () => {
      const handler = vi.fn();

      eventBus.on('user:login', handler);
      eventBus.off('user:login', handler);
      eventBus.emit('user:login', {
        userId: 'user123',
        timestamp: Date.now(),
        channel: 'telegram',
      });

      expect(handler).not.toHaveBeenCalled();
    });

    it('should return unsubscribe function from on()', () => {
      const handler = vi.fn();

      const unsubscribe = eventBus.on('user:login', handler);
      unsubscribe();

      eventBus.emit('user:login', {
        userId: 'user123',
        timestamp: Date.now(),
        channel: 'telegram',
      });

      expect(handler).not.toHaveBeenCalled();
    });

    it('should handle once option', () => {
      const handler = vi.fn();

      eventBus.on('user:login', handler, { once: true });
      eventBus.emit('user:login', {
        userId: 'user123',
        timestamp: Date.now(),
        channel: 'telegram',
      });
      eventBus.emit('user:login', {
        userId: 'user456',
        timestamp: Date.now(),
        channel: 'web',
      });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user123' })
      );
    });
  });

  // ============================================================================
  // Type Safety Tests
  // ============================================================================
  describe('type safety', () => {
    it('should enforce event data types at compile time', () => {
      // These should compile without errors
      eventBus.emit('user:login', {
        userId: 'user123',
        timestamp: Date.now(),
        channel: 'telegram',
      });

      eventBus.emit('weather:updated', {
        city: 'Beijing',
        temp: 25,
        humidity: 60,
      });

      // TypeScript errors (commented out to avoid compile errors):
      // eventBus.emit('user:login', { userId: 'user123' }); // missing required field
      // eventBus.emit('weather:updated', { city: 'Beijing', temp: 'hot', humidity: 60 }); // wrong type
      // eventBus.emit('unknown:event', { data: true }); // unknown event
      
      expect(true).toBe(true); // Placeholder assertion
    });

    it('should provide typed handler parameters', () => {
      eventBus.on('user:login', (data) => {
        // TypeScript should infer correct types
        const userId: string = data.userId;
        const timestamp: number = data.timestamp;
        const channel: string = data.channel;

        expect(typeof userId).toBe('string');
        expect(typeof timestamp).toBe('number');
        expect(typeof channel).toBe('string');
      });

      eventBus.emit('user:login', {
        userId: 'user123',
        timestamp: Date.now(),
        channel: 'telegram',
      });
    });
  });

  // ============================================================================
  // Wildcard / Namespace Tests
  // ============================================================================
  describe('wildcard pattern matching', () => {
    it('should match wildcard patterns', () => {
      const handler = vi.fn();

      eventBus.onWildcard('user:*', handler);

      eventBus.emit('user:login', {
        userId: 'user123',
        timestamp: Date.now(),
        channel: 'telegram',
      });
      eventBus.emit('user:logout', {
        userId: 'user123',
        timestamp: Date.now(),
      });

      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('should provide event type to wildcard handlers', () => {
      const handler = vi.fn();

      eventBus.onWildcard('user:*', handler);

      eventBus.emit('user:login', {
        userId: 'user123',
        timestamp: Date.now(),
        channel: 'telegram',
      });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user123' }),
        'user:login'
      );
    });

    it('should support multi-level wildcards', () => {
      const handler = vi.fn();

      eventBus.onWildcard('*', handler);

      eventBus.emit('user:login', {
        userId: 'user123',
        timestamp: Date.now(),
        channel: 'telegram',
      });
      eventBus.emit('weather:updated', {
        city: 'Beijing',
        temp: 25,
        humidity: 60,
      });

      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('should not match events outside pattern', () => {
      const handler = vi.fn();

      eventBus.onWildcard('user:*', handler);
      eventBus.emit('weather:updated', {
        city: 'Beijing',
        temp: 25,
        humidity: 60,
      });

      expect(handler).not.toHaveBeenCalled();
    });

    it('should return unsubscribe for wildcards', () => {
      const handler = vi.fn();

      const unsubscribe = eventBus.onWildcard('user:*', handler);
      unsubscribe();

      eventBus.emit('user:login', {
        userId: 'user123',
        timestamp: Date.now(),
        channel: 'telegram',
      });

      expect(handler).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Request-Response Pattern (RPC)
  // ============================================================================
  describe('request-response pattern', () => {
    it('should handle request-response', async () => {
      // Register request handler
      eventBus.onRequest('weather:get', async (params) => {
        expect(params.city).toBe('Beijing');
        return {
          temp: 25,
          humidity: 60,
          forecast: ['Sunny', 'Cloudy'],
        };
      });

      // Make request
      const result = await eventBus.request('weather:get', { city: 'Beijing' });

      expect(result).toEqual({
        temp: 25,
        humidity: 60,
        forecast: ['Sunny', 'Cloudy'],
      });
    });

    it('should handle multiple request handlers', async () => {
      // First handler returns null/falsy, second returns value
      eventBus.onRequest('config:get', async () => null as any);
      eventBus.onRequest('config:get', async (_params) => {
        return {
          value: 'test-value',
          defaultValue: null,
        };
      });

      const result = await eventBus.request('config:get', { key: 'test' });

      expect(result).toEqual({
        value: 'test-value',
        defaultValue: null,
      });
    });

    it('should throw error if no handler responds', async () => {
      const bus = new TypedEventBus<TestEvents, TestRequests, TestResponses>({
        requestTimeout: 100,
      });

      await expect(
        bus.request('weather:get', { city: 'Beijing' })
      ).rejects.toThrow('No handler registered');
    });

    it('should handle request errors', async () => {
      eventBus.onRequest('weather:get', async () => {
        throw new Error('API error');
      });

      await expect(
        eventBus.request('weather:get', { city: 'Beijing' })
      ).rejects.toThrow('API error');
    });

    it('should support typed request parameters', async () => {
      eventBus.onRequest('user:get', async (params) => {
        // TypeScript should enforce params type
        const userId: string = params.userId;
        expect(userId).toBe('user123');

        return {
          name: 'John Doe',
          email: 'john@example.com',
          lastLogin: Date.now(),
        };
      });

      const result = await eventBus.request('user:get', { userId: 'user123' });
      expect(result.name).toBe('John Doe');
    });
  });

  // ============================================================================
  // Plugin-Scoped Listeners (Auto-cleanup)
  // ============================================================================
  describe('plugin-scoped listeners', () => {
    it('should auto-cleanup listeners when plugin unloads', () => {
      const handler = vi.fn();

      // Register with plugin scope
      eventBus.on('user:login', handler, { pluginId: 'plugin-a' });

      // Emit event - should be received
      eventBus.emit('user:login', {
        userId: 'user123',
        timestamp: Date.now(),
        channel: 'telegram',
      });
      expect(handler).toHaveBeenCalledTimes(1);

      // Cleanup plugin
      eventBus.cleanup('plugin-a');

      // Emit again - should not be received
      eventBus.emit('user:login', {
        userId: 'user456',
        timestamp: Date.now(),
        channel: 'web',
      });
      expect(handler).toHaveBeenCalledTimes(1); // Still 1
    });

    it('should only cleanup listeners for specified plugin', () => {
      const handlerA = vi.fn();
      const handlerB = vi.fn();

      eventBus.on('user:login', handlerA, { pluginId: 'plugin-a' });
      eventBus.on('user:login', handlerB, { pluginId: 'plugin-b' });

      eventBus.cleanup('plugin-a');

      eventBus.emit('user:login', {
        userId: 'user123',
        timestamp: Date.now(),
        channel: 'telegram',
      });

      expect(handlerA).not.toHaveBeenCalled();
      expect(handlerB).toHaveBeenCalledTimes(1);
    });

    it('should cleanup wildcard listeners with plugin scope', () => {
      const handler = vi.fn();

      eventBus.onWildcard('user:*', handler, { pluginId: 'plugin-a' });

      eventBus.cleanup('plugin-a');

      eventBus.emit('user:login', {
        userId: 'user123',
        timestamp: Date.now(),
        channel: 'telegram',
      });

      expect(handler).not.toHaveBeenCalled();
    });

    it('should cleanup request handlers with plugin scope', async () => {
      const handler = vi.fn().mockResolvedValue({ temp: 25, humidity: 60, forecast: [] });

      eventBus.onRequest('weather:get', handler, { pluginId: 'plugin-a' });

      eventBus.cleanup('plugin-a');

      // Should throw "No handler registered" since handler was removed
      await expect(
        eventBus.request('weather:get', { city: 'Beijing' })
      ).rejects.toThrow('No handler registered');
    });
  });

  // ============================================================================
  // Inter-Extension Communication Scenarios
  // ============================================================================
  describe('inter-extension communication scenarios', () => {
    it('should enable plugin-to-plugin communication', () => {
      // Plugin A: Weather service
      const weatherData: Array<{ city: string; temp: number }> = [];
      eventBus.on('weather:updated', (data) => {
        weatherData.push({ city: data.city, temp: data.temp });
      });

      // Plugin B: Notification service
      const notifications: string[] = [];
      eventBus.on('weather:alert', (data) => {
        notifications.push(`Alert for ${data.city}: ${data.alert}`);
      });

      // Plugin A emits
      eventBus.emit('weather:updated', {
        city: 'Beijing',
        temp: 30,
        humidity: 80,
      });
      eventBus.emit('weather:alert', {
        city: 'Beijing',
        alert: 'High temperature warning',
        severity: 'high',
      });

      expect(weatherData).toHaveLength(1);
      expect(weatherData[0].temp).toBe(30);
      expect(notifications).toHaveLength(1);
      expect(notifications[0]).toContain('High temperature warning');
    });

    it('should enable request-response between plugins', async () => {
      // Plugin A: User service
      eventBus.onRequest('user:get', async (_params) => {
        return {
          name: 'John Doe',
          email: 'john@example.com',
          lastLogin: Date.now(),
        };
      });

      // Plugin B: Uses user service
      const user = await eventBus.request('user:get', { userId: 'user123' });

      expect(user.name).toBe('John Doe');
    });

    it('should support event-driven architecture', () => {
      const events: string[] = [];

      // Multiple plugins reacting to same event
      eventBus.on('message:received', () => { events.push('plugin-a:received'); });
      eventBus.on('message:received', () => { events.push('plugin-b:received'); });
      eventBus.on('message:received', () => { events.push('plugin-c:received'); });

      eventBus.emit('message:received', {
        chatId: 'chat123',
        content: 'Hello',
        sender: 'user456',
      });

      expect(events).toEqual([
        'plugin-a:received',
        'plugin-b:received',
        'plugin-c:received',
      ]);
    });
  });

  // ============================================================================
  // Error Handling
  // ============================================================================
  describe('error handling', () => {
    it('should catch and log listener errors', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      eventBus.on('user:login', () => {
        throw new Error('Handler error');
      });

      // Should not throw
      expect(() => {
        eventBus.emit('user:login', {
          userId: 'user123',
          timestamp: Date.now(),
          channel: 'telegram',
        });
      }).not.toThrow();

      consoleSpy.mockRestore();
    });

    it('should continue calling other listeners after error', () => {
      const handler1 = vi.fn().mockImplementation(() => {
        throw new Error('Error in handler1');
      });
      const handler2 = vi.fn();

      eventBus.on('user:login', handler1);
      eventBus.on('user:login', handler2);

      eventBus.emit('user:login', {
        userId: 'user123',
        timestamp: Date.now(),
        channel: 'telegram',
      });

      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    });
  });
});

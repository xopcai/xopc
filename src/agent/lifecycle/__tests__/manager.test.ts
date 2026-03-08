import { describe, it, expect, vi } from 'vitest';

// Mock the logger module before importing the manager
vi.mock('../../../utils/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { LifecycleManager } from '../manager.js';
import type {
  LifecycleHandler,
  LifecycleEventData,
  LLMRequestPayload,
} from '../types.js';

const mockContext = {
  sessionStore: {},
  compactor: {},
} as any;

describe('LifecycleManager', () => {
  it('should register and emit events', async () => {
    const manager = new LifecycleManager();
    const handlerFn = vi.fn();

    const handler: LifecycleHandler<LLMRequestPayload> = {
      name: 'TestHandler',
      handle: handlerFn,
    };

    manager.on('llm_request', handler);

    await manager.emit('llm_request', 'test-session', {
      requestNumber: 1,
      maxRequests: 10,
      messageCount: 5,
    }, mockContext);

    expect(handlerFn).toHaveBeenCalledTimes(1);
    expect(handlerFn).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'llm_request',
        sessionKey: 'test-session',
        payload: {
          requestNumber: 1,
          maxRequests: 10,
          messageCount: 5,
        },
      }),
      mockContext
    );
  });

  it('should support multiple handlers for same event', async () => {
    const manager = new LifecycleManager();
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    manager.on('llm_request', { name: 'Handler1', handle: handler1 });
    manager.on('llm_request', { name: 'Handler2', handle: handler2 });

    await manager.emit('llm_request', 'session-1', {
      requestNumber: 1,
      maxRequests: 10,
      messageCount: 5,
    }, mockContext);

    expect(handler1).toHaveBeenCalledTimes(1);
    expect(handler2).toHaveBeenCalledTimes(1);
  });

  it('should isolate handler errors', async () => {
    const manager = new LifecycleManager();
    const errorHandler = vi.fn().mockRejectedValue(new Error('Handler failed'));
    const successHandler = vi.fn();

    manager.on('llm_request', { name: 'ErrorHandler', handle: errorHandler });
    manager.on('llm_request', { name: 'SuccessHandler', handle: successHandler });

    await expect(
      manager.emit('llm_request', 'session-1', {
        requestNumber: 1,
        maxRequests: 10,
        messageCount: 5,
      }, mockContext)
    ).resolves.not.toThrow();

    expect(errorHandler).toHaveBeenCalledTimes(1);
    expect(successHandler).toHaveBeenCalledTimes(1);
  });

  it('should support method chaining', () => {
    const manager = new LifecycleManager();
    const handler = vi.fn();

    const result = manager
      .on('llm_request', { name: 'H1', handle: handler })
      .on('llm_response', { name: 'H2', handle: handler });

    expect(result).toBe(manager);
  });

  it('should return registered handlers info', () => {
    const manager = new LifecycleManager();
    
    manager.on('llm_request', { name: 'Handler1', handle: vi.fn() });
    manager.on('llm_request', { name: 'Handler2', handle: vi.fn() });
    manager.on('llm_response', { name: 'Handler3', handle: vi.fn() });

    const info = manager.getRegisteredHandlers();
    
    expect(info.llm_request).toHaveLength(2);
    expect(info.llm_response).toHaveLength(1);
    expect(info.llm_request).toContain('Handler1');
    expect(info.llm_request).toContain('Handler2');
    expect(info.llm_response).toContain('Handler3');
  });

  it('should clear all handlers', () => {
    const manager = new LifecycleManager();
    
    manager.on('llm_request', { name: 'Handler1', handle: vi.fn() });
    manager.clear();

    const info = manager.getRegisteredHandlers();
    expect(Object.keys(info)).toHaveLength(0);
  });

  it('should include timestamp in event data', async () => {
    const manager = new LifecycleManager();
    let capturedEvent: LifecycleEventData<any> | undefined;

    manager.on('llm_request', {
      name: 'CaptureHandler',
      handle: (event) => {
        capturedEvent = event;
      },
    });

    const beforeEmit = Date.now();
    await manager.emit('llm_request', 'session-1', { requestNumber: 1, maxRequests: 10, messageCount: 5 }, mockContext);
    const afterEmit = Date.now();

    expect(capturedEvent).toBeDefined();
    expect(capturedEvent!.timestamp).toBeGreaterThanOrEqual(beforeEmit);
    expect(capturedEvent!.timestamp).toBeLessThanOrEqual(afterEmit);
  });
});

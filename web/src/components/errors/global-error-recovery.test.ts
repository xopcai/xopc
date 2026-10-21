// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import { installGlobalErrorRecovery } from './global-error-recovery';

describe('installGlobalErrorRecovery', () => {
  let cleanup: (() => void) | undefined;

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  it('captures the first uncaught window error', () => {
    const onFatalError = vi.fn();
    cleanup = installGlobalErrorRecovery(onFatalError);

    window.dispatchEvent(new ErrorEvent('error', { error: new Error('event failed'), message: 'event failed' }));
    window.dispatchEvent(new ErrorEvent('error', { error: new Error('second error'), message: 'second error' }));

    expect(onFatalError).toHaveBeenCalledTimes(1);
    expect(onFatalError).toHaveBeenCalledWith(expect.objectContaining({ message: 'event failed' }), 'window.error');
  });

  it('captures unhandled promise rejections but ignores expected cancellation', () => {
    const onFatalError = vi.fn();
    cleanup = installGlobalErrorRecovery(onFatalError);

    const aborted = new Event('unhandledrejection', { cancelable: true });
    Object.defineProperty(aborted, 'reason', { value: new DOMException('Aborted', 'AbortError') });
    window.dispatchEvent(aborted);

    const rejected = new Event('unhandledrejection', { cancelable: true });
    Object.defineProperty(rejected, 'reason', { value: new Error('async failed') });
    window.dispatchEvent(rejected);

    expect(onFatalError).toHaveBeenCalledTimes(1);
    expect(onFatalError).toHaveBeenCalledWith(expect.objectContaining({ message: 'async failed' }), 'unhandledrejection');
  });

  it.each([
    'ResizeObserver loop completed with undelivered notifications.',
    'ResizeObserver loop limit exceeded',
  ])('keeps the app running after browser warning: %s', (message) => {
    const onFatalError = vi.fn();
    cleanup = installGlobalErrorRecovery(onFatalError);

    const warning = new ErrorEvent('error', {
      message,
      filename: 'http://localhost:3000/#/chat/conversation?workspaceTab=tab',
      cancelable: true,
    });
    window.dispatchEvent(warning);
    window.dispatchEvent(new ErrorEvent('error', { message }));

    expect(onFatalError).not.toHaveBeenCalled();
    expect(warning.defaultPrevented).toBe(false);

    window.dispatchEvent(new ErrorEvent('error', { message: 'Uncaught TypeError: render failed' }));

    expect(onFatalError).toHaveBeenCalledTimes(1);
    expect(onFatalError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Uncaught TypeError: render failed' }),
      'window.error',
    );
  });

  it('captures exceptions thrown by resize callbacks even with a matching warning message', () => {
    const onFatalError = vi.fn();
    cleanup = installGlobalErrorRecovery(onFatalError);

    const error = new Error('ResizeObserver loop completed with undelivered notifications.');
    window.dispatchEvent(new ErrorEvent('error', { error, message: error.message }));

    expect(onFatalError).toHaveBeenCalledWith(error, 'window.error');
  });
});

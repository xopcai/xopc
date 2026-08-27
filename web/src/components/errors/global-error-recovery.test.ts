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
});

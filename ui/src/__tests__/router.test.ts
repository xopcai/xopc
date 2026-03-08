import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRouter } from '../core/router.js';

describe('Router', () => {
  beforeEach(() => {
    // Reset location hash
    window.location.hash = '';
  });

  it('should create router with routes', () => {
    const router = createRouter({
      routes: [
        { path: '/' },
        { path: '/chat' },
        { path: '/chat/:sessionKey' },
      ],
    });

    expect(router).toBeDefined();
    expect(router.currentRoute).toBeNull();
  });

  it('should match exact route', () => {
    const router = createRouter({
      routes: [{ path: '/chat' }],
    });

    const result = router.navigate('/chat');
    expect(result).toBe(true);
    expect(router.currentRoute?.path).toBe('/chat');
  });

  it('should extract route params', async () => {
    const router = createRouter({
      routes: [{ path: '/chat/:sessionKey' }],
    });

    await router.navigate('/chat/gateway:abc123');
    
    expect(router.currentRoute?.params.sessionKey).toBe('gateway:abc123');
  });

  it('should parse query parameters', async () => {
    const router = createRouter({
      routes: [{ path: '/chat' }],
    });

    await router.navigate('/chat?tab=all&sort=date');
    
    expect(router.currentRoute?.query.tab).toBe('all');
    expect(router.currentRoute?.query.sort).toBe('date');
  });

  it('should call route change listeners', async () => {
    const router = createRouter({
      routes: [{ path: '/chat' }],
    });

    const listener = vi.fn();
    const unsubscribe = router.onRouteChange(listener);

    await router.navigate('/chat');

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/chat' }),
      null
    );

    unsubscribe();
  });

  it('should cancel navigation when beforeEach returns false', async () => {
    const router = createRouter({
      routes: [{ path: '/chat' }],
    });

    router.beforeEach(() => false);

    const result = await router.navigate('/chat');
    
    expect(result).toBe(false);
    expect(router.currentRoute).toBeNull();
  });

  it('should return false for unmatched routes', async () => {
    const router = createRouter({
      routes: [{ path: '/chat' }],
    });

    const result = await router.navigate('/unknown');
    
    expect(result).toBe(false);
  });
});

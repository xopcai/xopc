import { matchRoutes, type RouteObject } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { CHAT_SESSION_ROUTE_PATH } from '@/features/chat/chat-session-route';

describe('chat session route', () => {
  const sessionRoute: RouteObject = { path: CHAT_SESSION_ROUTE_PATH };
  const routes: RouteObject[] = [{ path: '/chat', children: [sessionRoute] }];

  it.each(['/chat', '/chat/new', '/chat/agent%3Amain%3Awebchat%3Adefault%3Adirect%3Achat_1'])(
    'keeps %s on the same chat-page route instance',
    (pathname) => {
      const matches = matchRoutes(routes, pathname);
      expect(matches?.at(-1)?.route).toBe(sessionRoute);
    },
  );
});

import type { Hono } from 'hono';
import { z } from 'zod';

import {
  deleteUserAvatar,
  readUserAvatar,
  writeUserAvatar,
} from '../../../user-context/user-avatar.js';
import type { AuthenticatedRouteDeps } from './deps.js';

const AvatarUploadSchema = z.strictObject({
  base64: z.string().min(1).max(3_000_000),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']),
});

export function registerUserAvatarRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const { service, strictRateLimitMiddleware } = deps;

  authenticated.get('/api/user-context/avatar', async (c) => {
    const res = await readUserAvatar();
    if (res.ok === false) {
      return c.json({ ok: false, error: res.error }, res.status);
    }
    return new Response(new Uint8Array(res.data.buffer), {
      status: 200,
      headers: {
        'Content-Type': res.data.contentType,
        'Cache-Control': 'private, no-cache',
      },
    });
  });

  authenticated.put('/api/user-context/avatar', strictRateLimitMiddleware, async (c) => {
    const raw = await c.req.json().catch(() => null);
    const parsed = AvatarUploadSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ ok: false, error: 'base64 and mimeType (image/png, image/jpeg, image/webp) are required' }, 400);
    }
    const res = await writeUserAvatar(parsed.data.base64, parsed.data.mimeType);
    if (res.ok === false) {
      return c.json({ ok: false, error: res.error }, res.status);
    }
    service.emit('user.avatar.updated', { configured: true, contentType: parsed.data.mimeType });
    return c.json({ ok: true, payload: { configured: true } });
  });

  authenticated.delete('/api/user-context/avatar', strictRateLimitMiddleware, async (c) => {
    await deleteUserAvatar();
    service.emit('user.avatar.updated', { configured: false });
    return c.json({ ok: true, payload: { configured: false } });
  });
}

import { z } from 'zod';

export const McpCallbackConfigSchema = z.strictObject({
  url: z.url().refine(value => {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash && !url.search;
  }, 'Use an HTTPS callback URL without credentials, query or fragment'),
  secretEnv: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
});

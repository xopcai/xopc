import { z } from 'zod';

export const OutboundProxySchema = z.object({
  mode: z.enum(['environment', 'custom', 'direct']).default('environment'),
  url: z.string().trim().max(2048).default(''),
  noProxy: z.string().trim().max(4096).default(''),
}).strict().superRefine((value, ctx) => {
  if (!value.url && value.mode !== 'custom') return;
  try {
    const url = new URL(value.url);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password
      || url.search || url.hash || (url.pathname && url.pathname !== '/')) throw new Error('Invalid proxy origin');
  } catch {
    ctx.addIssue({ code: 'custom', path: ['url'], message: 'Use an HTTP or HTTPS proxy origin without credentials, path, query or fragment' });
  }
});

export type OutboundProxyConfig = z.infer<typeof OutboundProxySchema>;

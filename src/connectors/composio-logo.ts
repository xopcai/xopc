const COMPOSIO_LOGO_SLUG = /^[a-z0-9_]{1,80}$/;
const COMPOSIO_LOGO_MAX_BYTES = 512 * 1024;
const COMPOSIO_LOGO_CONTENT_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
]);

export async function composioLogoResponse(toolkit: string): Promise<Response> {
  const slug = toolkit.trim().toLowerCase();
  if (!COMPOSIO_LOGO_SLUG.test(slug)) {
    return Response.json({ ok: false, error: 'Invalid toolkit slug.' }, { status: 400 });
  }
  const upstream = await fetch(`https://logos.composio.dev/api/${encodeURIComponent(slug)}`, {
    headers: { Accept: 'image/png,image/webp,image/svg+xml,image/*;q=0.8' },
    redirect: 'error',
    signal: AbortSignal.timeout(8_000),
  });
  if (!upstream.ok) {
    return Response.json({ ok: false, error: 'Connector logo is unavailable.' }, { status: 404 });
  }
  const contentType = upstream.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '';
  if (!COMPOSIO_LOGO_CONTENT_TYPES.has(contentType)) {
    return Response.json({ ok: false, error: 'Connector logo has an unsupported format.' }, { status: 415 });
  }
  const declaredLength = Number(upstream.headers.get('content-length') ?? '0');
  if (declaredLength > COMPOSIO_LOGO_MAX_BYTES) {
    return Response.json({ ok: false, error: 'Connector logo is too large.' }, { status: 413 });
  }
  const data = await upstream.arrayBuffer();
  if (data.byteLength > COMPOSIO_LOGO_MAX_BYTES) {
    return Response.json({ ok: false, error: 'Connector logo is too large.' }, { status: 413 });
  }
  return new Response(data, {
    headers: {
      'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
      'Content-Length': String(data.byteLength),
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
      'Content-Type': contentType,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

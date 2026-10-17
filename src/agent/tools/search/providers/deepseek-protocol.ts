export function deepseekSearchEndpoint(baseUrl = 'https://api.deepseek.com'): string {
  const url = new URL(baseUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
    || !['', '/', '/v1', '/v1/'].includes(url.pathname)) {
    throw new Error('DeepSeek API base URL must be an HTTPS origin with optional /v1');
  }
  return `${url.origin}/v1/tools/search`;
}

export function deepseekSearchBody(query: string, count: number): string {
  if (!query.trim() || Array.from(query).length > 128) {
    throw new Error('DeepSeek search query must contain 1–128 Unicode characters');
  }
  return JSON.stringify({ query, count: Math.max(1, Math.min(50, Math.floor(count))), need_content: false });
}

export function deepseekSearchResults(body: unknown): Array<{ title: string; url: string; description: string; publishedAt?: string }> {
  if (!body || typeof body !== 'object' || !('results' in body) || !Array.isArray(body.results)) {
    throw new Error('DeepSeek search returned an invalid response');
  }
  const seen = new Set<string>();
  return body.results.flatMap((item: unknown) => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    if (typeof row.title !== 'string' || !row.title.trim() || typeof row.url !== 'string') return [];
    let url: URL;
    try { url = new URL(row.url); } catch { return []; }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || seen.has(url.href)) return [];
    seen.add(url.href);
    const description = typeof row.summary === 'string' && row.summary.trim() ? row.summary
      : typeof row.snippet === 'string' ? row.snippet : '';
    return [{ title: row.title.trim().slice(0, 300), url: url.href, description: description.trim().slice(0, 800),
      ...(typeof row.date === 'string' && row.date.length <= 100 ? { publishedAt: row.date } : {}) }];
  });
}

export async function readDeepseekResponse(response: Response): Promise<unknown> {
  const limit = 2 * 1024 * 1024;
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel();
    throw new Error('DeepSeek search response is too large');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('DeepSeek search returned an empty response');
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) { await reader.cancel(); throw new Error('DeepSeek search response is too large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new Error('DeepSeek search returned invalid JSON'); }
}

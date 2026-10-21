/** Share request capacity with candidate generation and other judge processes. */
export async function withSharedPool<T>(pool: 'generation' | 'judge', context: Record<string, unknown>, action: () => Promise<T>): Promise<T> {
  const url = process.env.XOPC_STYLE_POOL_URL;
  if (!url) return action();
  const request = async (path: string, body: unknown): Promise<any> => {
    const response = await fetch(url + path, {
      method: 'POST', headers: { Authorization: `Bearer ${process.env.XOPC_STYLE_POOL_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(3_600_000),
    });
    if (!response.ok) throw new Error(`Shared pool ${response.status}`);
    return response.json();
  };
  const { lease } = await request('/acquire', { pool, context });
  let error: string | null = null;
  try { return await action(); }
  catch (exception) { error = exception instanceof Error ? exception.message : String(exception); throw exception; }
  finally { await request('/release', { lease, error }); }
}

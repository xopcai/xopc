import { searchHttpError } from '../errors.js';
import { SearchRequestGate, SearchRateLimitError } from '../request-gate.js';
import type { SearchProvider, SearchResult } from '../types.js';
import { deepseekSearchBody, deepseekSearchEndpoint, deepseekSearchResults, readDeepseekResponse } from './deepseek-protocol.js';

// Shared across registry instances: separate keys can belong to the same account.
const gate = new SearchRequestGate();
export class DeepSeekProvider implements SearchProvider {
  readonly name = 'deepseek';
  constructor(private readonly apiKey: string, private readonly baseUrl?: string) {}
  isAvailable(): boolean { return Boolean(this.apiKey.trim()); }

  async search(query: string, count: number, signal?: AbortSignal): Promise<SearchResult[]> {
    const endpoint = deepseekSearchEndpoint(this.baseUrl);
    const body = deepseekSearchBody(query, count);
    try { await gate.wait(signal); }
    catch (error) {
      if (error instanceof SearchRateLimitError) {
        throw searchHttpError(new Response(null, { status: 429, headers: { 'retry-after': String(error.retryAfterMs / 1000) } }));
      }
      throw error;
    }
    const response = await fetch(endpoint, {
      method: 'POST', redirect: 'error', signal,
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json', accept: 'application/json' }, body,
    });
    if (!response.ok) {
      if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after');
        const ms = retryAfter === null ? 1_000 : Number.isFinite(Number(retryAfter))
          ? Number(retryAfter) * 1_000 : Date.parse(retryAfter) - Date.now();
        gate.cooldown(Number.isFinite(ms) ? Math.max(1_000, ms) : 1_000);
      }
      await response.body?.cancel();
      throw searchHttpError(response, response.status === 402 ? 'DeepSeek search account balance is insufficient' : `DeepSeek search failed (${response.status})`);
    }
    return deepseekSearchResults(await readDeepseekResponse(response)).slice(0, count)
      .map(({ publishedAt: _date, ...result }) => ({ ...result, source: this.name }));
  }
}

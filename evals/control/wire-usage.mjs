/** Bounded streaming usage projection; never persists model text, headers or credentials. */
export function usageObserver() {
  const decoder = new TextDecoder();
  let buffer = '', rawUsage = null, usage = null, responseId = null, responseModel = null, overflow = false;
  function consume(line) {
    const raw = line.startsWith('data:') ? line.slice(5).trim() : line.trim();
    if (!raw || raw === '[DONE]') return;
    try {
      const value = JSON.parse(raw), response = value.response ?? value;
      const u = response.usage;
      if (typeof response.id === 'string') responseId = response.id;
      if (typeof response.model === 'string') responseModel = response.model;
      if (u && typeof u === 'object') {
        const numbers = value => typeof value === 'number' ? value : value && typeof value === 'object'
          ? Object.fromEntries(Object.entries(value).filter(([,v]) => typeof v === 'number' || v && typeof v === 'object').map(([k,v]) => [k,numbers(v)])) : null;
        rawUsage = numbers(u);
        const input = u.prompt_tokens ?? u.input_tokens;
        const output = u.completion_tokens ?? u.output_tokens;
        if (Number.isFinite(input) && Number.isFinite(output)) usage = {
          input, output, total: u.total_tokens ?? input + output,
          cacheRead: u.prompt_tokens_details?.cached_tokens ?? u.input_tokens_details?.cached_tokens ?? null,
        };
      }
    } catch { /* SSE metadata and partial JSON are not usage records. */ }
  }
  return {
    push(bytes) {
      buffer += decoder.decode(bytes, { stream: true });
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) { consume(buffer.slice(0, end)); buffer = buffer.slice(end + 1); }
      if (buffer.length > 2_000_000) { buffer = ''; overflow = true; }
    },
    finish() { buffer += decoder.decode(); consume(buffer); return { rawUsage, usage, responseId, responseModel, overflow }; },
  };
}

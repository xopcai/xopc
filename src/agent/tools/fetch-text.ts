import { lookup } from 'node:dns';
import { Agent as HttpAgent, fetch } from 'undici';

import { checkUrlSafety, checkWebsiteBlocklist, type WebsiteBlocklistConfig } from './url-safety.js';

/** Validate each redirect and the address actually used for the connection. */
export async function fetchPublicText(input: string, blocklist: WebsiteBlocklistConfig | undefined, signal?: AbortSignal) {
  const deadline = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(25_000)]);
  const dispatcher = new HttpAgent({ connect: { lookup(hostname, options, callback) {
    lookup(hostname, { all: true }, (error, addresses) => {
      if (error) { callback(error, '', 4); return; }
      if (!addresses.length || addresses.some(item => !checkUrlSafety(`http://${item.family === 6 ? `[${item.address}]` : item.address}`).safe)) {
        callback(new Error('DNS resolved to a non-public address'), '', 4); return;
      }
      if (options.all) callback(null, addresses);
      else callback(null, addresses[0]!.address, addresses[0]!.family);
    });
  } } });
  try {
    let url = input;
    for (let redirects = 0; redirects <= 5; redirects++) {
      deadline.throwIfAborted();
      const safety = checkUrlSafety(url);
      if (!safety.safe) throw new Error(`Blocked: ${safety.reason}`);
      const blocked = checkWebsiteBlocklist(url, blocklist);
      if (blocked) throw new Error(`Blocked: ${blocked.message}`);
      const response = await fetch(url, { signal: deadline, redirect: 'manual', dispatcher });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        const location = response.headers.get('location');
        if (!location) throw new Error('Redirect has no location');
        url = new URL(location, url).href;
        continue;
      }
      if (!response.ok) { await response.body?.cancel(); throw new Error(`HTTP ${response.status}`); }
      const reader = response.body?.getReader();
      if (!reader) return { text: '', contentType: response.headers.get('content-type') ?? '', url };
      const decoder = new TextDecoder();
      let text = '', bytes = 0;
      try {
        for (;;) {
          deadline.throwIfAborted();
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > 6_000_000) throw new Error('Response too large');
          text += decoder.decode(chunk.value, { stream: true });
        }
        text += decoder.decode();
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      return { text, contentType: response.headers.get('content-type') ?? '', url };
    }
    throw new Error('Too many redirects');
  } finally { await dispatcher.close(); }
}

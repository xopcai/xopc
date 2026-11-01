import { createHash } from 'node:crypto';

import { deviceEnvironmentText } from './device-environment.js';
import { APP_CONTEXT_BOUNDARY, BROWSER_CONTEXT_BOUNDARY, DEVICE_CONTEXT_BOUNDARY, SOURCE_CONTEXT_BOUNDARY } from './injector.js';

export const HISTORICAL_SOURCE_CONTEXT_TTL_MS = 30 * 60_000;

function escapeAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
}

function summaryCaptureTime(metadata: unknown, kind: string, id: string, version: string): number | undefined {
  if (!metadata || typeof metadata !== 'object') return undefined;
  const sources = (metadata as { sourceContexts?: unknown }).sourceContexts;
  if (!Array.isArray(sources)) return undefined;
  const source = sources.find(source => source && source.kind === kind && typeof source.sourceId === 'string'
    && typeof source.version === 'string' && escapeAttribute(source.sourceId) === id && escapeAttribute(source.version) === version);
  return typeof source?.capturedAt === 'number' ? source.capturedAt : undefined;
}

/** Request-only projection: retain provenance, deduplicate snapshots, and recheck freshness. */
export function projectSourceContextsForLlm<T extends { role: string; content?: unknown; timestamp?: unknown; metadata?: unknown }>(
  messages: readonly T[], now = Date.now(),
): T[] {
  const seen = new Set<string>();
  const snapshots = new Map<string, { id: string; version: string }>();
  const latestUserIndex = messages.findLastIndex(message => message.role === 'user');
  const result = [...messages];
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== 'user') continue;
    const projectText = (text: string): string => {
      // Only inspect the generated context envelope, never the user's text or tool results.
      const envelope = /^(<source_contexts>\n)([\s\S]*?)(\n<\/source_contexts>\n\n<user_message>\n[\s\S]*\n<\/user_message>)$/u.exec(text);
      if (!envelope) return text;
      // Literal prompt markup can occur in quoted files/notes. Leave ambiguous envelopes intact.
      const remaining = envelope[2]
        .replace(/<source_context kind="([^"]*)" id="([^"]*)" version="([^"]*)"(?: captured_at="(\d+)")?>\n([\s\S]*?)\n<\/source_context>/gu, '')
        .replace(/^<source_(?:device|context_ref) [^\n]*\/>$/gmu, '').trim();
      if (remaining) return text;
      const contexts = envelope[2].replace(
        /<source_context kind="([^"]*)" id="([^"]*)" version="([^"]*)"(?: captured_at="(\d+)")?>\n([\s\S]*?)\n<\/source_context>/gu,
        (block, kind: string, id: string, version: string, capturedAt: string | undefined, body: string) => {
          if (['note', 'file', 'task', 'session', 'result', 'user_assertion'].includes(kind)) {
            if (!body.startsWith(`${SOURCE_CONTEXT_BOUNDARY}\n\n`)) return block;
            // Explicit references retain all distinct source versions and excerpts, without a TTL.
            const key = JSON.stringify([kind, id, version, createHash('sha256').update(body).digest('hex')]);
            const previous = snapshots.get(key);
            if (previous) {
              const reference = `<source_context_ref kind="${kind}" id="${id}" version="${version}" status="duplicate" retained_id="${previous.id}" retained_version="${previous.version}"/>`;
              return reference.length + 256 < block.length ? reference : block;
            }
            snapshots.set(key, { id, version });
            return block;
          }
          if (kind === 'app_context' || kind === 'browser_page' || kind === 'browser_tab') {
            const boundary = kind === 'app_context' ? APP_CONTEXT_BOUNDARY : BROWSER_CONTEXT_BOUNDARY;
            if (!body.startsWith(`${boundary}\n\n`)) return block;
            const time = capturedAt === undefined ? summaryCaptureTime(message.metadata, kind, id, version) ?? message.timestamp : Number(capturedAt);
            const expired = i !== latestUserIndex && typeof time === 'number' && Number.isFinite(time)
              && (time <= now - HISTORICAL_SOURCE_CONTEXT_TTL_MS || time > now + 60_000);
            const reference = `<source_context_ref kind="${kind}" id="${id}" version="${version}"`;
            if (expired) return `${reference} status="expired"${typeof time === 'number' ? ` captured_at="${time}"` : ''}/>`;
            // Capture IDs, timestamps and envelope hashes change even when the source content does not.
            const key = `${kind}:${createHash('sha256').update(body).digest('hex')}`;
            const previous = snapshots.get(key);
            if (previous) return `${reference} status="duplicate" retained_id="${previous.id}" retained_version="${previous.version}"/>`;
            snapshots.set(key, { id, version });
            return block;
          }
          if (kind !== 'device_context' || !body.startsWith(`${DEVICE_CONTEXT_BOUNDARY}\n\n`)) return block;
          const json = body.slice(DEVICE_CONTEXT_BOUNDARY.length + 2);
          try {
            const snapshot = JSON.parse(json);
            if (!snapshot || typeof snapshot.endpointId !== 'string' || escapeAttribute(snapshot.endpointId) !== id) return block;
            if (seen.has(snapshot.endpointId)) return `<source_device id="${id}"/>`;
            seen.add(snapshot.endpointId);
            const projected = deviceEnvironmentText({ kind: 'device_context', sourceId: snapshot.endpointId, version, title: snapshot.name ?? snapshot.endpointId, text: json }, now);
            return block.replace(`\n\n${json}\n`, () => `\n\n${projected}\n`);
          } catch { return block; }
        },
      );
      return envelope[1] + contexts + envelope[3];
    };
    if (typeof message.content === 'string') {
      const content = projectText(message.content);
      if (content !== message.content) result[i] = { ...message, content };
    } else if (Array.isArray(message.content)) {
      let changed = false;
      const content = message.content.map(block => {
        if (!block || block.type !== 'text' || typeof block.text !== 'string') return block;
        const text = projectText(block.text);
        if (text === block.text) return block;
        changed = true;
        return { ...block, text };
      });
      if (changed) result[i] = { ...message, content };
    }
  }
  return result;
}

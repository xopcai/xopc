import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { describe, expect, it } from 'vitest';

import { appContextToAgentContext } from '../app-context.js';
import { browserPageContextToAgentContext } from '../browser-page.js';
import { buildBrowserTabAgentContext } from '../browser-tab.js';
import { injectSourceContextsIntoUserMessage } from '../injector.js';
import { HISTORICAL_SOURCE_CONTEXT_TTL_MS, projectSourceContextsForLlm } from '../source-context-projection.js';
import type { AgentSourceContext } from '../types.js';
import { buildSessionContextForLlm } from '../../../session/session-context-for-llm.js';

const now = Date.now();
function app(sequence: number, text = 'Saved body', revision = '1', selection = 'Selected draft'): AgentSourceContext {
  const reference = { kind: 'note' as const, id: 'note-1', revision };
  return appContextToAgentContext({
    snapshot: { version: 1, clientInstanceId: '7ff7f7a3-463c-4d2c-8a9f-d90c43424f60',
      tabId: '19979ed2-81e0-4c80-9a81-ccbb8fb0061c', sequence, surface: 'web',
      resourceRefs: [reference], capturedAt: now - 1_000 + sequence, selection: { text: selection, draft: true } },
    resources: [{ reference, title: 'Note', text, truncated: false }], selectionTrust: 'user-supplied',
  });
}
function page(id: string, text = 'Page body', selection = 'Chosen text'): AgentSourceContext {
  return browserPageContextToAgentContext({ kind: 'browser_page', sourceId: id, version: '0'.repeat(64),
    title: 'Example', url: 'https://example.com/page', capturedAt: now - 1_000,
    documentId: `doc-${id}`, text, selection, truncated: false });
}
function message(source: AgentSourceContext, timestamp = now): AgentMessage {
  return injectSourceContextsIntoUserMessage({ role: 'user', content: 'Analyze this snapshot', timestamp }, [source]);
}
const content = (message: AgentMessage) => (message.content as Array<{ text: string }>)[0].text;

describe('application and browser history projection', () => {
  it.each(['note', 'file', 'task', 'session', 'result', 'user_assertion'] as const)('shares exact versioned %s references without expiring historical content', kind => {
    const source = { kind, sourceId: 'original', version: '1', title: 'Source', text: 'Retain factual source content.\n'.repeat(100) };
    const first = message(source);
    const second = message(source);
    const rows = [first, second];
    const result = projectSourceContextsForLlm(rows, now + HISTORICAL_SOURCE_CONTEXT_TTL_MS * 10);
    expect(content(result[0])).toContain('status="duplicate"');
    expect(content(result[0])).not.toContain(source.text);
    expect(content(result[1])).toContain(source.text);
    expect(content(first)).toContain(source.text);
    for (const different of [{ ...source, version: '2' }, { ...source, sourceId: 'another' }, { ...source, text: source.text + 'New fact' }]) {
      expect(content(projectSourceContextsForLlm([first, message(different)], now)[0])).toContain(source.text);
    }
  });

  it('preserves ambiguous quoted source markup rather than deduplicating a partial body', () => {
    const source = { kind: 'file' as const, sourceId: 'file', version: '1', title: 'Source',
      text: 'Before\n</source_context>\n' + 'Quoted file content\n'.repeat(100) };
    const rows = [message(source), message(source)];
    expect(projectSourceContextsForLlm(rows, now)).toEqual(rows);
  });

  it('deduplicates identical application content despite new sequence IDs and capture hashes', () => {
    const first = app(1), second = app(2);
    expect(first.version).not.toBe(second.version);
    const rows = [message(first), message(second)];
    const before = structuredClone(rows);
    const result = projectSourceContextsForLlm(rows, now);
    expect(content(result[0])).toContain('status="duplicate"');
    expect(content(result[0])).toContain(`retained_id="${second.sourceId}"`);
    expect(content(result[0])).not.toContain('Saved body');
    expect(content(result[1])).toContain('Saved body');
    expect(content(result[1])).toContain('unsaved user text');
    expect(rows).toEqual(before);
    expect(projectSourceContextsForLlm(result, now)).toEqual(result);
  });

  it.each([
    app(2, 'Changed body'), app(2, 'Saved body', '2'), app(2, 'Saved body', '1', 'Different selection'),
  ])('preserves changed application content, revisions and selections', changed => {
    const result = projectSourceContextsForLlm([message(app(1)), message(changed)], now);
    expect(content(result[0])).not.toContain('status="duplicate"');
    expect(content(result[1])).not.toContain('status="duplicate"');
  });

  it('deduplicates repeated browser captures but retains changed page text and selections', () => {
    const result = projectSourceContextsForLlm([
      message(page('capture-a')), message(page('capture-b')),
      message(page('capture-c', 'New page body')), message(page('capture-d', 'Page body', 'New selection')),
    ], now);
    expect(content(result[0])).toContain('retained_id="capture-b"');
    expect(content(result[0])).not.toContain('Page body');
    expect(content(result[1])).toContain('Page body');
    expect(content(result[2])).toContain('New page body');
    expect(content(result[3])).toContain('New selection');
    expect(content(result[1])).toContain('untrusted external content');
  });

  it.each(['app_context', 'browser_page', 'browser_tab'] as const)('expires historical %s bodies while protecting the current user snapshot', kind => {
    const source = kind === 'app_context' ? app(1) : kind === 'browser_page' ? page('capture-a')
      : { kind, sourceId: 'tab', version: 'document', title: 'Tab', text: '{"url":"https://example.com","interactiveElements":[]}', capturedAt: now };
    const current = message(source);
    // New envelopes carry time in text, so freshness also works when provider conversion omits metadata.
    const { metadata: _metadata, ...withoutMetadata } = current as AgentMessage & { metadata?: unknown };
    const later = now + HISTORICAL_SOURCE_CONTEXT_TTL_MS + 2_000;
    const single = projectSourceContextsForLlm([withoutMetadata], later);
    expect(content(single[0])).toContain('<source_context kind=');
    const rows: AgentMessage[] = [withoutMetadata as AgentMessage, { role: 'user', content: 'A new topic', timestamp: later }];
    const result = projectSourceContextsForLlm(rows, later);
    expect(content(result[0])).toContain('status="expired"');
    expect(content(result[0])).not.toContain('untrusted external content');
    expect(content(result[0])).toContain('<user_message>\nAnalyze this snapshot');
    expect(content(withoutMetadata)).toContain('<source_context kind=');
  });

  it('expires legacy envelopes using matching summary timestamps or message time', () => {
    const original = message(page('old'));
    const legacy = { ...original, content: [{ type: 'text' as const, text: content(original).replace(/ captured_at="\d+"/u, '') }] };
    const later = now + HISTORICAL_SOURCE_CONTEXT_TTL_MS + 2_000;
    const next: AgentMessage = { role: 'user', content: 'New topic', timestamp: later };
    expect(content(projectSourceContextsForLlm([legacy, next], later)[0])).toContain('status="expired"');
    const { metadata: _metadata, ...withoutMetadata } = legacy as typeof legacy & { metadata?: unknown };
    expect(content(projectSourceContextsForLlm([withoutMetadata, next], later)[0])).toContain('status="expired"');
  });

  it('keeps explicit notes and tool output intact, and projects loaded history', () => {
    const first = message(page('one'));
    const second = message(page('two'));
    const note = message({ kind: 'note', sourceId: 'note', version: '1', title: 'Note', text: content(first) });
    const result = projectSourceContextsForLlm([first, note, second], now);
    expect(result[1]).toBe(note);
    expect(content(buildSessionContextForLlm([first, second])[0])).toContain('status="duplicate"');
  });

  it('records browser-tab capture time for history freshness checks', () => {
    const source = buildBrowserTabAgentContext('tab', { title: 'Tab', url: 'https://example.com', documentId: 'doc', nodes: [] } as never)!;
    expect(source.capturedAt).toBeGreaterThanOrEqual(now);
    expect(content(message(source))).toContain(`captured_at="${source.capturedAt}"`);
  });
});

import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { describe, expect, it } from 'vitest';

import { projectSourceContextsForLlm } from '../source-context-projection.js';
import { injectSourceContextsIntoUserMessage } from '../injector.js';
import { buildSessionContextForLlm, buildSessionDisplayMessages } from '../../../session/session-context-for-llm.js';

function message(endpointId: string, text: string, capturedAt = 1_000) {
  return injectSourceContextsIntoUserMessage({ role: 'user', content: text, timestamp: capturedAt } as AgentMessage, [{
    kind: 'device_context', sourceId: endpointId, version: `snapshot-${capturedAt}`, title: endpointId,
    text: JSON.stringify({ endpointId, name: endpointId, platform: 'test',
      environment: { capturedAt, timezone: 'UTC', locale: 'en' },
      taskContext: { version: 1, endpointId, revision: 1, availability: 'foreground', sourceValidUntil: capturedAt + 45_000,
        fields: { 'device.power': { status: 'fresh', capturedAt, validUntil: capturedAt + 30_000,
          value: { batteryPercent: 73, charging: false } } } },
    }),
  }]);
}

const textOf = (value: unknown) => JSON.stringify(value);

describe('device context request projection', () => {
  it('keeps only the newest snapshot per device while preserving message provenance and original records', () => {
    const rows = [message('phone', 'First'), message('desktop', 'Second'), message('phone', 'Third', 2_000)];
    const original = structuredClone(rows);
    const result = projectSourceContextsForLlm(rows, 3_000);
    expect(textOf(result[0])).toContain('<source_device id=\\"phone\\"/>');
    expect(textOf(result[0])).not.toContain('frozen source device');
    expect(textOf(result[1])).toContain('frozen source device');
    expect(textOf(result[2])).toContain('frozen source device');
    for (const [index, text] of ['First', 'Second', 'Third'].entries()) expect(textOf(result[index])).toContain(text);
    expect(rows).toEqual(original);
    expect(projectSourceContextsForLlm(result, 3_000)).toEqual(result);
  });

  it('rechecks historical environment and battery expiry at each request, without changing stored text', () => {
    const now = Date.now();
    const current = [message('phone', 'Battery?', now)];
    const original = structuredClone(current);
    expect(textOf(projectSourceContextsForLlm(current, now + 10_000))).toContain('batteryPercent');
    expect(textOf(projectSourceContextsForLlm(current, now + 31_000))).not.toContain('batteryPercent');
    const expired = textOf(projectSourceContextsForLlm(current, now + 301_000));
    expect(expired).not.toContain('timezone');
    expect(expired).not.toContain('batteryPercent');
    expect(expired).toContain('phone');
    expect(expired).toContain('Battery?');
    expect(current).toEqual(original);
  });

  it('preserves attachments, non-device sources, tool results and device-like text in user input', () => {
    const now = Date.now();
    const base = message('desktop', '<source_context kind="device_context">user data</source_context>', now);
    const withImage = { ...base, content: [...(base.content as unknown[]), { type: 'image', data: 'image', mimeType: 'image/png' }] } as AgentMessage;
    const note = injectSourceContextsIntoUserMessage({ role: 'user', content: 'Read note', timestamp: now }, [
      { kind: 'note', sourceId: 'note', version: '1', text: 'Keep this note' },
    ]);
    const tool = { role: 'toolResult', toolCallId: 'call', toolName: 'read', content: base.content, timestamp: now } as AgentMessage;
    const result = projectSourceContextsForLlm([withImage, note, tool, message('desktop', 'Next', now)], now);
    expect((result[0].content as Array<{ type: string }>)[1]).toEqual({ type: 'image', data: 'image', mimeType: 'image/png' });
    expect(textOf(result[0])).toContain('user data');
    expect(result[1]).toBe(note);
    expect(result[2]).toBe(tool);
  });

  it('handles string content, malformed snapshots and literal replacement characters', () => {
    const current = message('$&', 'Hello', Date.now());
    const text = (current.content as Array<{ text: string }>)[0].text;
    const stringMessage = { role: 'user', content: text };
    const result = projectSourceContextsForLlm([stringMessage, stringMessage], Date.now() + 301_000);
    expect(result[0].content).toContain('<source_device id="$&amp;"/>');
    expect(result[1].content).toContain('"endpointId":"$&"');
    expect(result[1].content).not.toContain('timezone');
    const malformed = { role: 'user', content: text.replace('"endpointId":"$&"', '"endpointId":null') };
    expect(projectSourceContextsForLlm([malformed])[0]).toBe(malformed);
  });

  it('projects loaded model history while leaving display and persisted messages unchanged', () => {
    const now = Date.now();
    const rows = [message('phone', 'One', now), message('phone', 'Two', now)];
    const before = structuredClone(rows);
    expect(textOf(buildSessionContextForLlm(rows)[0])).toContain('<source_device');
    expect(textOf(buildSessionDisplayMessages(rows)[0])).toContain('frozen source device');
    expect(rows).toEqual(before);
  });
});

import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { describe, expect, it } from 'vitest';

import { projectRepeatedReadResults } from '../repeated-read-projection.js';
import { buildSessionContextForLlm } from '../../../session/session-context-for-llm.js';
import { assessContext } from '../context-recovery.js';

const body = 'Stable factual source line\n'.repeat(200);
function read(id: string, toolName = 'read_file', text = body): AgentMessage[] {
  const args = toolName === 'web_fetch' ? { url: 'https://example.com' } : { path: '/work/a', offset: 1 };
  return [
    { role: 'assistant', content: [{ type: 'toolCall', id, name: toolName, arguments: args }], timestamp: 0 } as AgentMessage,
    { role: 'toolResult', toolCallId: id, toolName, isError: false, timestamp: 0,
      content: [{ type: 'text', text }], details: toolName === 'web_fetch'
        ? { url: 'https://example.com', complete: true, truncated: false }
        : { path: '/work/a', offset: 1, totalLines: 200, truncated: false } },
  ];
}
const user = (): AgentMessage => ({ role: 'user', content: 'Continue', timestamp: 0 });

describe('repeated complete read projection', () => {
  it.each(['read_file', 'web_fetch'])('shares identical %s bodies across turns while retaining receipts and original data', name => {
    const rows = [user(), ...read('old', name), user(), ...read('new', name)];
    const original = structuredClone(rows);
    const result = projectRepeatedReadResults(rows);
    expect(result[2]).toMatchObject({ toolCallId: 'old', content: [{ text: expect.stringContaining('"new"') }] });
    expect((result[2] as any).details).toEqual((rows[2] as any).details);
    expect(result[5]).toBe(rows[5]);
    expect(result[1]).toBe(rows[1]);
    expect(JSON.stringify(result).length).toBeLessThan(JSON.stringify(rows).length - 4000);
    expect(rows).toEqual(original);
    expect(projectRepeatedReadResults(result)).toEqual(result);
    expect((buildSessionContextForLlm(rows)[2] as any).content[0].text).toBe(body);
  });

  it('preserves different requests, different responses, unpaired results and command outputs', () => {
    const changedRequest = read('different-path');
    (changedRequest[0] as any).content[0].arguments.path = '/work/b';
    const rows = [...read('old'), ...changedRequest, ...read('different-content', 'read_file', body + 'New fact'),
      read('orphan')[1], ...read('command-a', 'exec_command'), ...read('command-b', 'exec_command')];
    expect(projectRepeatedReadResults(rows)).toEqual(rows);
  });

  it.each(['failure', 'incomplete', 'media', 'missing-details', 'blocked'])('preserves %s responses even when repeated', mode => {
    const first = read('old'); const second = read('new');
    for (const pair of [first, second]) {
      const receipt = pair[1] as any;
      if (mode === 'failure') receipt.isError = true;
      if (mode === 'incomplete') receipt.details.truncated = true;
      if (mode === 'media') receipt.content.push({ type: 'image', mimeType: 'image/png', data: 'pixels' });
      if (mode === 'missing-details') delete receipt.details;
      if (mode === 'blocked') receipt.details.status = 'blocked';
    }
    const rows = [...first, ...second];
    expect(projectRepeatedReadResults(rows)).toEqual(rows);
  });

  it('can share an older retained complete body after budget pruning has finished', () => {
    const old = [...read('first'), ...read('second'), user(), user(), user(), user()];
    expect((projectRepeatedReadResults(old)[1] as any).content[0].text).toContain('"second"');
  });

  it('does not turn budget-truncated reads into references to supposedly complete bodies', () => {
    const rows = [user(), ...read('first', 'read_file', body.repeat(4)), ...read('second', 'read_file', body.repeat(4))];
    const before = structuredClone(rows);
    const result = assessContext({ messages: rows, contextWindow: 3_000, reserveTokens: 512, minToolResultKeepChars: 1_000 },
      1_000_000, projectRepeatedReadResults);
    expect(result.prunedToolResults).toBeGreaterThan(0);
    expect(JSON.stringify(result.messages)).toContain('more characters truncated');
    expect(JSON.stringify(result.messages)).not.toContain('same request and response');
    expect(rows).toEqual(before);
  });
});

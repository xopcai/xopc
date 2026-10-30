import { describe, expect, it, vi } from 'vitest';
import { ChatCompletionsComputerAdapter, parseGuiPlusProposal } from '../model-adapter.js';
import { computerDiagnostic } from '../errors.js';
import { ComputerSessionDiagnostics } from '../diagnostics.js';

const secret = 'private input hello 机密';
function guiError(args: unknown) {
  try { parseGuiPlusProposal(`<tool_call>${JSON.stringify({ name: 'computer_use', arguments: args })}</tool_call>`, 800, 600); }
  catch (error) { return error; }
  throw new Error('Expected rejection');
}
async function structuredError(proposal: unknown, summary = '{}', api?: string) {
  const args = JSON.stringify({ proposal });
  const fetch = vi.fn().mockResolvedValue(Response.json(api === 'openai-responses'
    ? { output: [{ type: 'function_call', name: 'computer_proposal', arguments: args }] }
    : { choices: [{ message: { tool_calls: [{ function: { name: 'computer_proposal', arguments: args } }] } }] }));
  const adapter = new ChatCompletionsComputerAdapter({ modelId: 'm', baseUrl: 'https://example.com/v1',
    apiKey: 'private-test-key', profile: 'structured-tools-v1', api }, fetch);
  try { await adapter.predict({ goal: secret, image: new Uint8Array([1]), mimeType: 'image/png', width: 800, height: 600, summary }); }
  catch (error) { return error; }
  throw new Error('Expected rejection');
}

describe('private computer validation diagnostics', () => {
  it('identifies the GUI action and missing field and survives report serialization', () => {
    const error = guiError({ action: 'type', text: secret });
    const validation = { action: 'type', stage: 'schema', issues: [
      { path: ['arguments', 'coordinate'], code: 'invalid_type', action: 'type' },
    ] };
    expect(computerDiagnostic(error)?.validation).toEqual(validation);
    const report = new ComputerSessionDiagnostics();
    report.fail(error, 'model'); report.finish(true);
    expect(report.snapshot().failure).toMatchObject({ validation, dispatch: 'notStarted' });
    expect(JSON.stringify(report.snapshot())).not.toContain(secret);
    expect(String(error)).not.toContain(secret);
  });
  it('redacts arbitrary action values and extra property names', () => {
    for (const error of [guiError({ action: secret }), guiError({ action: 'type', text: secret, coordinate: [2, 3], [secret]: secret })]) {
      const diagnostic = computerDiagnostic(error);
      expect(diagnostic?.validation).toBeDefined();
      expect(JSON.stringify(diagnostic)).not.toContain(secret);
    }
    expect(computerDiagnostic(guiError({ action: 'wait', time: 1, [secret]: secret }))?.validation?.issues)
      .toContainEqual({ path: ['arguments', 'unknown_field'], code: 'unrecognized_keys', action: 'wait' });
  });
  it('locates an invalid primitive inside a batch without retaining its text', () => {
    const error = guiError({ action: 'batch', actions: [{ kind: 'setValue', ref: secret, text: secret },
      { kind: 'pressKeys', keys: ['invalid private key!'] }] });
    expect(computerDiagnostic(error)?.validation).toMatchObject({ action: 'batch', issues: [
      { path: ['arguments', 'actions', 1, 'keys', 0], code: 'invalid_format', action: 'pressKeys' },
    ] });
    expect(String(error)).not.toMatch(/private|机密/);
  });
  it('identifies invalid converted keys', () => {
    expect(computerDiagnostic(guiError({ action: 'key', keys: ['invalid private key!'] }))?.validation)
      .toMatchObject({ action: 'pressKeys', stage: 'converted_action', issues: [{ path: ['keys', 0], code: 'invalid_format' }] });
  });
  it.each([undefined, 'openai-responses'])('preserves target diagnostics through %s parsing', async api => {
    const error = await structuredError({ kind: 'action', action: { kind: 'typeText', text: secret, point: { x: 20, y: 20 } } }, '{}', api);
    expect(computerDiagnostic(error)?.validation).toMatchObject({ action: 'typeText', stage: 'typing_target',
      issues: [{ path: ['action', 'point'], code: 'editable_target_missing' }] });
    expect(String(error)).not.toContain(secret);
  });
  it.each([
    [{ x: 800, y: 20 }, '{}', 'outside_frame'],
    [{ x: 20, y: 20 }, 'not json', 'invalid_context'],
    [{ x: 20, y: 20 }, JSON.stringify({ elements: Array(2).fill({ role: 'AXTextField', label: secret,
      bounds: { x: 0, y: 0, width: 100, height: 100 } }) }), 'editable_target_ambiguous'],
  ])('distinguishes typing target failures: %s', async (point, summary, code) => {
    const error = await structuredError({ kind: 'action', action: { kind: 'typeText', text: secret, point } }, summary);
    expect(computerDiagnostic(error)?.validation?.issues[0].code).toBe(code);
    expect(String(error)).not.toContain(secret);
  });
  it('reports a missing structured typing point without exposing the draft', async () => {
    const error = await structuredError({ kind: 'action', action: { kind: 'typeText', text: secret } });
    expect(computerDiagnostic(error)?.validation).toMatchObject({ action: 'typeText', stage: 'schema',
      issues: [{ path: ['proposal', 'action', 'point'], code: 'invalid_type' }] });
    expect(String(error)).not.toContain(secret);
  });
  it('keeps nested typing failures tied to their batch index', async () => {
    const error = await structuredError({ kind: 'action', action: { kind: 'batch', actions: [
      { kind: 'wait', durationMs: 0 }, { kind: 'typeText', text: secret, point: { x: 20, y: 20 } },
    ] } });
    expect(computerDiagnostic(error)?.validation).toMatchObject({ action: 'batch', issues: [
      { action: 'typeText', path: ['action', 'actions', 1, 'point'], code: 'editable_target_missing' },
    ] });
    expect(String(error)).not.toContain(secret);
  });
  it('reports unsupported native key normalization', async () => {
    const error = await structuredError({ kind: 'action', action: { kind: 'pressKeys', keys: ['not_a_real_key'] } });
    expect(computerDiagnostic(error)?.validation).toMatchObject({ action: 'pressKeys', stage: 'keyboard',
      issues: [{ path: ['action', 'keys'], code: 'unsupported_key' }] });
    expect(String(error)).not.toContain('not_a_real_key');
  });
  it('bounds oversized issue lists and removes all unexpected property names', () => {
    const extras = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`${secret}${i}`, secret]));
    const diagnostic = computerDiagnostic(guiError({ action: 'wait', time: 1, ...extras }));
    expect(diagnostic?.validation?.issues).toHaveLength(4);
    expect(JSON.stringify(diagnostic)).not.toContain(secret);
  });
});

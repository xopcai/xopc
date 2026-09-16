import { beforeEach, expect, it, vi } from 'vitest';
import { apiFetch } from '../../api/client';
import { cancelSessionInput, fetchSessionInputs, queuedMessages, sessionInputStateSchema, updateSessionInput } from '../session-inputs';

vi.mock('../../api/client', () => ({ apiFetch: vi.fn(), formatApiHttpError: (status: number, _: string, message: string) => `${status}: ${message}` }));
const request = vi.mocked(apiFetch);
const input = { id: 'input/one', clientMessageId: 'one', kind: 'message', status: 'queued', content: 'Continue', position: 1, version: 3, effectiveDelivery: 'next' };
const state = { conversationId: 'chat/one', inputs: [input] };
beforeEach(() => request.mockReset());

it('shows only user-editable queued messages in server order', () => {
  const parsed = sessionInputStateSchema.parse({ ...state, inputs: [
    { ...input, id: 'late', position: 4 },
    { ...input, id: 'running', status: 'running' },
    { ...input, id: 'resume', kind: 'connection_resume' },
    { ...input, id: 'early', position: 2, effectiveDelivery: 'steer' },
    { ...input, id: 'suspended', status: 'suspended' },
  ] });
  expect(queuedMessages(parsed).map(item => item.id)).toEqual(['early', 'late']);
  expect(parsed.inputs[0].id).toBe('late');
});
it('validates server data instead of inventing an empty queue', async () => {
  request.mockResolvedValue(new Response(JSON.stringify({ payload: { conversationId: 'chat/one' } })));
  await expect(fetchSessionInputs('chat/one')).rejects.toThrow();
});
it('patches only content at the exact reviewed version, preserving attachments and references', async () => {
  request.mockResolvedValue(new Response(JSON.stringify({ payload: state })));
  await updateSessionInput('chat/one', { id: 'input/one', version: 3 }, 'Revised');
  expect(request).toHaveBeenCalledWith('/api/sessions/chat%2Fone/inputs/input%2Fone', { method: 'PATCH', body: JSON.stringify({ version: 3, content: 'Revised' }) });
});
it('cancels at the reviewed version and never silently retries a conflict', async () => {
  request.mockResolvedValue(new Response(JSON.stringify({ payload: state, error: { message: 'Input changed' } }), { status: 409 }));
  await expect(cancelSessionInput('chat/one', { id: 'input/one', version: 3 })).rejects.toThrow('409');
  expect(request).toHaveBeenCalledExactlyOnceWith('/api/sessions/chat%2Fone/inputs/input%2Fone?version=3', { method: 'DELETE' });
});

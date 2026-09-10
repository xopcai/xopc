import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createConsentController,
  requiresDataSharingConsent,
  waitForConsentDecision,
} from '../consent-controller';

describe('data sharing consent', () => {
  let gatewayId: string | null;
  let revision: string;
  let memory: Map<string, string>;
  let confirm: ReturnType<typeof vi.fn<() => Promise<'accepted' | 'declined' | 'cancelled'>>>;
  let controller: ReturnType<typeof createConsentController>;

  beforeEach(() => {
    gatewayId = 'gateway-one';
    revision = 'revision-one';
    memory = new Map();
    confirm = vi.fn(async () => 'accepted' as const);
    controller = createConsentController({
      activeGatewayId: () => gatewayId,
      loadDisclosure: async () => ({ version: 1, revision, recipients: [] }),
      confirm,
      read: (key) => memory.get(key),
      write: (key, value) => { memory.set(key, value); },
      errorMessage: () => 'Permission required',
    });
  });

  it('remembers approval only for the same gateway and recipient revision', async () => {
    await controller.ensure();
    await controller.ensure();
    expect(confirm).toHaveBeenCalledTimes(1);
    revision = 'different-provider-origin';
    await controller.ensure();
    gatewayId = 'gateway-two';
    await controller.ensure();
    expect(confirm).toHaveBeenCalledTimes(3);
  });

  it('migrates a legacy approval but discards legacy denials created by cancellation races', async () => {
    memory.set('privacy.dataSharing.v1:gateway-one', 'revision-one');
    await controller.ensure();
    expect(confirm).not.toHaveBeenCalled();
    expect(memory.get('privacy.dataSharing.v2:gateway-one')).toBe('revision-one');

    gatewayId = 'gateway-two';
    memory.set('privacy.dataSharing.v1:gateway-two', 'denied');
    await controller.ensure();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(memory.get('privacy.dataSharing.v2:gateway-two')).toBe('revision-one');
  });

  it('coalesces concurrent submissions into one decision', async () => {
    let finish!: (decision: 'accepted' | 'declined' | 'cancelled') => void;
    confirm.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const first = controller.ensure();
    const second = controller.ensure();
    await vi.waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    finish('accepted');
    await Promise.all([first, second]);
    expect([...memory.values()]).toEqual(['revision-one']);
  });

  it('persists an explicit decline and does not repeatedly prompt on background retries', async () => {
    confirm.mockResolvedValue('declined');
    await expect(controller.ensure()).rejects.toThrow('Permission required');
    await expect(controller.ensure()).rejects.toThrow('Permission required');
    expect([...memory.values()]).toEqual(['denied']);
    expect(confirm).toHaveBeenCalledTimes(1);
    confirm.mockResolvedValue('accepted');
    await controller.ensure(true);
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it('discards an approval if the active gateway changed while the dialog was open', async () => {
    confirm.mockImplementation(async () => { gatewayId = 'another-gateway'; return 'accepted'; });
    await expect(controller.ensure()).rejects.toThrow('Permission required');
    expect(memory.size).toBe(0);
  });

  it('withdrawal invalidates an in-flight approval and pauses future submissions', async () => {
    confirm.mockImplementation(async () => { controller.revoke('gateway-one'); return 'accepted'; });
    await expect(controller.ensure()).rejects.toThrow('Permission required');
    await expect(controller.ensure()).rejects.toThrow('Permission required');
    expect([...memory.values()]).toEqual(['denied']);
  });

  it('does not submit against recipients changed while the dialog was open', async () => {
    confirm.mockImplementation(async () => { revision = 'new-recipient'; return 'accepted'; });
    await expect(controller.ensure()).rejects.toThrow('Permission required');
    expect(memory.size).toBe(0);
  });

  it('does not let one cancelled request discard a shared approval', async () => {
    let finish!: (decision: 'accepted' | 'declined' | 'cancelled') => void;
    confirm.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const abort = new AbortController();
    const first = waitForConsentDecision(() => controller.ensure(), abort.signal, () => 'Permission required');
    const second = waitForConsentDecision(() => controller.ensure(), undefined, () => 'Permission required');
    await vi.waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));

    abort.abort();
    await expect(first).rejects.toThrow('Permission required');
    finish('accepted');

    await expect(second).resolves.toBeUndefined();
    expect([...memory.values()]).toEqual(['revision-one']);
  });

  it('does not persist a denial when the app lifecycle only cancels the dialog', async () => {
    confirm.mockResolvedValueOnce('cancelled').mockResolvedValueOnce('accepted');

    await expect(controller.ensure()).rejects.toThrow('Permission required');
    expect(memory.size).toBe(0);
    await expect(controller.ensure()).resolves.toBeUndefined();

    expect(confirm).toHaveBeenCalledTimes(2);
    expect([...memory.values()]).toEqual(['revision-one']);
  });

  it('explicit review shows the recipients even after approval', async () => {
    await controller.ensure();
    await controller.ensure(true);
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it('requires permission for content and AI actions while allowing reads, deletion and stopping work', () => {
    for (const path of ['/api/sessions/s/inputs', '/api/tasks/t/inputs', '/api/notes', '/api/media', '/api/voice/speech', '/api/voice/transcriptions', '/api/workspace/sync', '/api/automations/a/run', '/api/files/s/upload', '/api/clarifications/c/responses']) {
      expect(requiresDataSharingConsent(path, 'POST'), path).toBe(true);
      expect(requiresDataSharingConsent(`${path.slice(1)}?source=mobile`, 'POST'), path).toBe(true);
      expect(requiresDataSharingConsent(path, 'GET'), path).toBe(false);
      expect(requiresDataSharingConsent(path, 'DELETE'), path).toBe(false);
    }
    for (const path of ['/api/realtime/tickets', '/api/agent/abort', '/api/workflows/runs/a/cancel', '/api/automations/a/pause', '/api/endpoint-tools/principals']) {
      expect(requiresDataSharingConsent(path, 'POST'), path).toBe(false);
    }
    expect(requiresDataSharingConsent('/api/sessions', 'POST')).toBe(false);
    expect(requiresDataSharingConsent('/api/sessions/chat%3Amain/agent-config', 'PATCH')).toBe(false);
    expect(requiresDataSharingConsent('/api/sessions/chat%3Amain/inputs', 'POST')).toBe(true);
  });
});

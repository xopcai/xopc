import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createConsentController, requiresDataSharingConsent } from '../consent-controller';

describe('data sharing consent', () => {
  let gatewayId: string | null;
  let revision: string;
  let memory: Map<string, string>;
  let confirm: ReturnType<typeof vi.fn<() => Promise<boolean>>>;
  let controller: ReturnType<typeof createConsentController>;

  beforeEach(() => {
    gatewayId = 'gateway-one';
    revision = 'revision-one';
    memory = new Map();
    confirm = vi.fn(async () => true);
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

  it('coalesces concurrent submissions into one decision', async () => {
    let finish!: (accepted: boolean) => void;
    confirm.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const first = controller.ensure();
    const second = controller.ensure();
    await vi.waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    finish(true);
    await Promise.all([first, second]);
  });

  it('declines without saving and does not repeatedly prompt on background retries', async () => {
    confirm.mockResolvedValue(false);
    await expect(controller.ensure()).rejects.toThrow('Permission required');
    await expect(controller.ensure()).rejects.toThrow('Permission required');
    expect([...memory.values()]).toEqual(['denied']);
    expect(confirm).toHaveBeenCalledTimes(1);
    confirm.mockResolvedValue(true);
    await controller.ensure(true);
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it('discards an approval if the active gateway changed while the dialog was open', async () => {
    confirm.mockImplementation(async () => { gatewayId = 'another-gateway'; return true; });
    await expect(controller.ensure()).rejects.toThrow('Permission required');
    expect(memory.size).toBe(0);
  });

  it('withdrawal invalidates an in-flight approval and pauses future submissions', async () => {
    confirm.mockImplementation(async () => { controller.revoke('gateway-one'); return true; });
    await expect(controller.ensure()).rejects.toThrow('Permission required');
    await expect(controller.ensure()).rejects.toThrow('Permission required');
    expect([...memory.values()]).toEqual(['denied']);
  });

  it('does not submit against recipients changed while the dialog was open', async () => {
    confirm.mockImplementation(async () => { revision = 'new-recipient'; return true; });
    await expect(controller.ensure()).rejects.toThrow('Permission required');
    expect(memory.size).toBe(0);
  });

  it('does not record consent when the originating request was cancelled', async () => {
    const abort = new AbortController();
    confirm.mockImplementation(async () => { abort.abort(); return true; });
    await expect(controller.ensure(false, abort.signal)).rejects.toThrow('Permission required');
    expect(memory.size).toBe(0);
  });

  it('explicit review shows the recipients even after approval', async () => {
    await controller.ensure();
    await controller.ensure(true);
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it('requires permission for content and AI actions while allowing reads, deletion and stopping work', () => {
    for (const path of ['/api/sessions/s/inputs', '/api/tasks/t/inputs', '/api/notes', '/api/media', '/api/voice/speech', '/api/voice/transcriptions', '/api/workspace/sync', '/api/automations/a/run', '/api/files/s/upload', '/api/clarify/c']) {
      expect(requiresDataSharingConsent(path, 'POST'), path).toBe(true);
      expect(requiresDataSharingConsent(`${path.slice(1)}?source=mobile`, 'POST'), path).toBe(true);
      expect(requiresDataSharingConsent(path, 'GET'), path).toBe(false);
      expect(requiresDataSharingConsent(path, 'DELETE'), path).toBe(false);
    }
    for (const path of ['/api/realtime/tickets', '/api/agent/abort', '/api/workflows/runs/a/cancel', '/api/automations/a/pause', '/api/endpoint-tools/principals']) {
      expect(requiresDataSharingConsent(path, 'POST'), path).toBe(false);
    }
  });
});

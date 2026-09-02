import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  pick: vi.fn(),
  share: vi.fn(),
  sharingAvailable: vi.fn(),
  directoryCreate: vi.fn(),
  directoryDelete: vi.fn(),
  fileCreate: vi.fn(),
  fileWrite: vi.fn(),
  notify: vi.fn(),
}));

vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn() }));
vi.mock('expo-device', () => ({
  brand: 'brand', manufacturer: 'maker', modelName: 'phone', osName: 'os', osVersion: '1',
}));
vi.mock('expo-document-picker', () => ({ getDocumentAsync: state.pick }));
vi.mock('expo-linking', () => ({ openURL: vi.fn() }));
vi.mock('expo-contacts', () => ({
  ContactField: {
    FULL_NAME: 'fullName',
    GIVEN_NAME: 'givenName',
    FAMILY_NAME: 'familyName',
    PHONES: 'phones',
    EMAILS: 'emails',
  },
  Contact: class {},
  getPermissionsAsync: vi.fn(),
  requestPermissionsAsync: vi.fn(),
}));
vi.mock('expo-sharing', () => ({
  isAvailableAsync: state.sharingAvailable,
  shareAsync: state.share,
}));
vi.mock('expo-file-system', () => ({
  Paths: { cache: { uri: 'file:///cache' } },
  Directory: class {
    uri = 'file:///cache/endpoint-tools/invocation';
    create = state.directoryCreate;
    delete = state.directoryDelete;
  },
  File: class {
    uri = 'file:///cache/endpoint-tools/invocation/result.txt';
    create = state.fileCreate;
    write = state.fileWrite;
  },
}));
vi.mock('../../notifications/mobile-notifications', () => ({
  showLocalMobileNotification: state.notify,
}));

import { EndpointToolRegistry } from '@xopcai/endpoint-tools-client';

import { MOBILE_ENDPOINT_TOOL_DEFINITIONS } from '../tools';

describe('mobile endpoint file tools', () => {
  const registry = new EndpointToolRegistry(MOBILE_ENDPOINT_TOOL_DEFINITIONS);
  const uploadFile = vi.fn(async (file: { name: string; mimeType: string; bytes: Uint8Array }) => ({
    type: 'file' as const,
    fileId: 'file-1',
    name: file.name,
    mimeType: file.mimeType,
    size: file.bytes.byteLength,
    sha256: 'a'.repeat(64),
  }));
  const context = { uploadFile };

  beforeEach(() => {
    vi.clearAllMocks();
    state.sharingAvailable.mockResolvedValue(true);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))));
  });

  it('uploads the single file explicitly returned by the system picker', async () => {
    state.pick.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///picked/note.txt', name: 'note.txt', mimeType: 'text/plain', size: 3 }],
    });

    await expect(registry.get('mobile.file.pick')!.definition.execute({}, {
      ...context,
      invocationId: 'invocation-1',
      signal: new AbortController().signal,
      reportProgress: vi.fn(),
    })).resolves.toEqual({
      content: [expect.objectContaining({ type: 'file', fileId: 'file-1', name: 'note.txt' })],
    });
    expect(uploadFile).toHaveBeenCalledWith({
      name: 'note.txt', mimeType: 'text/plain', bytes: new Uint8Array([1, 2, 3]),
    });
  });

  it('does not upload when the system picker is cancelled', async () => {
    state.pick.mockResolvedValue({ canceled: true, assets: null });
    await expect(registry.get('mobile.file.pick')!.definition.execute({}, {
      ...context,
      invocationId: 'invocation-1',
      signal: new AbortController().signal,
      reportProgress: vi.fn(),
    })).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it('shares a bounded temporary text file and removes it afterwards', async () => {
    await expect(registry.get('mobile.file.share')!.definition.execute(
      { suggestedName: 'result.txt', content: 'done' },
      {
        ...context,
        invocationId: 'invocation-1',
        signal: new AbortController().signal,
        reportProgress: vi.fn(),
      },
    )).resolves.toEqual({ content: [{ type: 'text', text: 'Shared result.txt' }] });
    expect(state.fileWrite).toHaveBeenCalledWith('done');
    expect(state.share).toHaveBeenCalledWith(
      'file:///cache/endpoint-tools/invocation/result.txt',
      expect.objectContaining({ mimeType: 'text/plain' }),
    );
    expect(state.directoryDelete).toHaveBeenCalledOnce();
  });

  it('rejects path-like share names before creating a temporary file', async () => {
    await expect(registry.get('mobile.file.share')!.definition.execute(
      { suggestedName: '../result.txt', content: 'done' },
      {
        ...context,
        invocationId: 'invocation-1',
        signal: new AbortController().signal,
        reportProgress: vi.fn(),
      },
    )).rejects.toThrow('Invalid file share arguments');
    expect(state.directoryCreate).not.toHaveBeenCalled();
  });

  it('shows a bounded local notification without requesting permission', async () => {
    await expect(registry.get('mobile.notification.show')!.definition.execute(
      { title: 'Finished', body: 'Your task is ready.' },
      {
        ...context,
        invocationId: 'invocation-1',
        signal: new AbortController().signal,
        reportProgress: vi.fn(),
      },
    )).resolves.toEqual({ content: [{ type: 'text', text: 'Notification shown.' }] });
    expect(state.notify).toHaveBeenCalledWith('Finished', 'Your task is ready.');
  });
});

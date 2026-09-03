import { readFile, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const saveMediaBufferMock = vi.fn();

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  realpath: vi.fn(),
}));

vi.mock('../../../media/store.js', () => ({
  mimeTypeFromMediaPath: (filePath: string) => filePath.endsWith('.xlsx')
    ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    : 'application/octet-stream',
  saveMediaBuffer: (...args: unknown[]) => saveMediaBufferMock(...args),
}));

import { createPublishArtifactsTool } from '../publish-artifacts.js';
import { fileResourceId, fileSpaceId } from '../../../files/file-service.js';

const readFileMock = vi.mocked(readFile);

describe('publish_artifacts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(realpath).mockImplementation(async (path) => resolve(String(path)));
  });

  it('publishes generated spreadsheets as explicit durable artifacts', async () => {
    readFileMock.mockResolvedValue(Buffer.from('xlsx'));
    saveMediaBufferMock.mockResolvedValue({
      id: 'sales---id.xlsx',
      bucket: 'outbound',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      path: '/state/media/outbound/sales---id.xlsx',
      size: 4,
      uri: 'media://outbound/sales---id.xlsx',
    });

    const result = await createPublishArtifactsTool('/workspace').execute('publish-1', {
      paths: ['reports/sales.xlsx'],
    });

    expect(readFileMock).toHaveBeenCalledWith(resolve('/workspace/reports/sales.xlsx'));
    expect(result.details.artifacts).toEqual([{
      artifactId: 'sales---id.xlsx',
      sourceFileId: fileResourceId(fileSpaceId(resolve('/workspace')), 'reports/sales.xlsx'),
      title: 'sales.xlsx',
      kind: 'spreadsheet',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      sizeBytes: 4,
      availability: 'available',
      location: 'artifact_store',
      capabilities: ['preview', 'download'],
      uri: 'media://outbound/sales---id.xlsx',
    }]);
  });

  it('keeps successful files visible when another file cannot be published', async () => {
    readFileMock
      .mockResolvedValueOnce(Buffer.from('xlsx'))
      .mockRejectedValueOnce(new Error('missing'));
    saveMediaBufferMock.mockResolvedValue({
      id: 'sales---id.xlsx',
      bucket: 'outbound',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      path: '/state/media/outbound/sales---id.xlsx',
      size: 4,
      uri: 'media://outbound/sales---id.xlsx',
    });

    const result = await createPublishArtifactsTool('/workspace').execute('publish-2', {
      paths: ['reports/sales.xlsx', 'reports/missing.xlsx'],
    });

    expect(result.details.artifacts).toEqual([
      expect.objectContaining({ title: 'sales.xlsx', availability: 'available' }),
      expect.objectContaining({
        artifactId: 'publish-failed:publish-2:1',
        title: 'missing.xlsx',
        kind: 'spreadsheet',
        availability: 'failed',
        location: 'workspace',
        capabilities: ['regenerate'],
      }),
    ]);
  });

  it('rejects sensitive external paths through the sandbox path policy', async () => {
    const result = await createPublishArtifactsTool('/workspace').execute('publish-3', {
      paths: [`${process.env.HOME}/.ssh/id_rsa`],
    });

    expect(readFileMock).not.toHaveBeenCalled();
    expect(result.details.artifacts).toEqual([
      expect.objectContaining({
        title: 'id_rsa',
        availability: 'failed',
        location: 'external_host',
      }),
    ]);
  });
});

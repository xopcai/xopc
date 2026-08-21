import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { EndpointUploadService } from '../upload-service.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('EndpointUploadService', () => {
  it('accepts grant-bound files and rejects forged result descriptors', () => {
    const root = mkdtempSync(join(tmpdir(), 'xopc-endpoint-upload-'));
    roots.push(root);
    const service = new EndpointUploadService(root);
    const grant = service.createGrant('invocation-1', 'endpoint-1', 1_000);
    const file = service.upload({
      invocationId: 'invocation-1',
      endpointId: 'endpoint-1',
      token: grant.token,
      name: 'result.txt',
      mimeType: 'text/plain',
      bytes: new TextEncoder().encode('result'),
      now: 1_001,
    });
    expect(() => service.validateAndClose('invocation-1', [{
      type: 'file',
      fileId: file.fileId,
      name: file.name,
      mimeType: file.mimeType,
      size: file.size,
      sha256: '0'.repeat(64),
    }])).toThrow('not valid');
  });

  it('closes a grant after a valid result', () => {
    const root = mkdtempSync(join(tmpdir(), 'xopc-endpoint-upload-'));
    roots.push(root);
    const service = new EndpointUploadService(root);
    const grant = service.createGrant('invocation-2', 'endpoint-1');
    const file = service.upload({
      invocationId: 'invocation-2', token: grant.token, name: 'a.txt',
      endpointId: 'endpoint-1',
      mimeType: 'text/plain', bytes: new TextEncoder().encode('a'),
    });
    service.validateAndClose('invocation-2', [{
      type: 'file', fileId: file.fileId, name: file.name, mimeType: file.mimeType,
      size: file.size, sha256: file.sha256,
    }]);
    expect(() => service.upload({
      invocationId: 'invocation-2', token: grant.token, name: 'b.txt',
      endpointId: 'endpoint-1',
      mimeType: 'text/plain', bytes: new TextEncoder().encode('b'),
    })).toThrow('invalid');
  });
});

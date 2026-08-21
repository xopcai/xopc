import { describe, expect, it } from 'vitest';

import { classifyFileReferenceFsError } from '../file-reference-errors.js';

describe('classifyFileReferenceFsError', () => {
  it.each(['ENOENT', 'ENOTDIR'])('treats %s as a missing file', (code) => {
    expect(classifyFileReferenceFsError(Object.assign(new Error(code), { code }))).toEqual({
      code: 'FILE_NOT_FOUND',
      message: 'File not found',
      status: 404,
    });
  });

  it.each(['EACCES', 'EPERM'])('keeps %s distinct from a missing file', (code) => {
    expect(classifyFileReferenceFsError(Object.assign(new Error(code), { code }))).toEqual({
      code: 'FILE_ACCESS_DENIED',
      message: 'Gateway does not have permission to access this file',
      status: 403,
    });
  });

  it('classifies unexpected filesystem failures separately', () => {
    expect(classifyFileReferenceFsError(Object.assign(new Error('I/O failure'), { code: 'EIO' }))).toEqual({
      code: 'FILE_ACCESS_FAILED',
      message: 'Gateway could not access this file',
      status: 500,
    });
  });
});

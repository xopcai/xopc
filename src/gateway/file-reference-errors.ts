export type FileReferenceFsError = {
  code: 'FILE_NOT_FOUND' | 'FILE_ACCESS_DENIED' | 'FILE_ACCESS_FAILED';
  message: string;
  status: 404 | 403 | 500;
};

export function classifyFileReferenceFsError(err: unknown): FileReferenceFsError {
  const code = (err as NodeJS.ErrnoException | null)?.code;
  if (code === 'ENOENT' || code === 'ENOTDIR') {
    return { code: 'FILE_NOT_FOUND', message: 'File not found', status: 404 };
  }
  if (code === 'EACCES' || code === 'EPERM') {
    return { code: 'FILE_ACCESS_DENIED', message: 'Gateway does not have permission to access this file', status: 403 };
  }
  return { code: 'FILE_ACCESS_FAILED', message: 'Gateway could not access this file', status: 500 };
}

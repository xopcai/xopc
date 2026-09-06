import { isAbsolute, relative, resolve } from 'node:path';
export function safePath(root, input) {
  const base = resolve(root), result = resolve(base, input), rel = relative(base, result);
  if (rel === '..' || rel.startsWith('..\\') || rel.startsWith('../') || isAbsolute(rel)) throw new Error('outside root');
  return result;
}

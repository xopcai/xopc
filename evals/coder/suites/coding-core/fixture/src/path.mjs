import { resolve } from 'node:path';
export function safePath(root, input) {
  const result = resolve(root, input);
  if (!result.startsWith(root)) throw new Error('outside root');
  return result;
}

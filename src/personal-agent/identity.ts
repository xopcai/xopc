import { createHash } from 'node:crypto';

export function personalAgentId(ownerId: string): string {
  return `personal-${createHash('sha256').update(ownerId).digest('hex').slice(0, 12)}`;
}

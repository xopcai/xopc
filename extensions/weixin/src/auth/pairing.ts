import fs from 'node:fs';
import path from 'node:path';

import { resolveFrameworkAllowFromPath } from './accounts.js';
import { logger } from '../util/logger.js';

export { resolveFrameworkAllowFromPath };

type AllowFromFileContent = {
  version: number;
  allowFrom: string[];
};

export function readFrameworkAllowFromList(accountId: string): string[] {
  const filePath = resolveFrameworkAllowFromPath(accountId);
  try {
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as AllowFromFileContent;
    if (Array.isArray(parsed.allowFrom)) {
      return parsed.allowFrom.filter((id): id is string => typeof id === 'string' && id.trim() !== '');
    }
  } catch {
    // best-effort
  }
  return [];
}

export async function registerUserInFrameworkStore(params: {
  accountId: string;
  userId: string;
}): Promise<{ changed: boolean }> {
  const { accountId, userId } = params;
  const trimmedUserId = userId.trim();
  if (!trimmedUserId) return { changed: false };

  const filePath = resolveFrameworkAllowFromPath(accountId);

  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });

  if (!fs.existsSync(filePath)) {
    const initial: AllowFromFileContent = { version: 1, allowFrom: [] };
    fs.writeFileSync(filePath, JSON.stringify(initial, null, 2), 'utf-8');
  }

  let content: AllowFromFileContent = { version: 1, allowFrom: [] };
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as AllowFromFileContent;
    if (Array.isArray(parsed.allowFrom)) {
      content = parsed;
    }
  } catch {
    // start fresh
  }

  if (content.allowFrom.includes(trimmedUserId)) {
    return { changed: false };
  }

  content.allowFrom.push(trimmedUserId);
  fs.writeFileSync(filePath, JSON.stringify(content, null, 2), 'utf-8');
  logger.info(
    `registerUserInFrameworkStore: added userId=${trimmedUserId} accountId=${accountId} path=${filePath}`,
  );
  return { changed: true };
}

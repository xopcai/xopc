import fs from 'node:fs';
import path from 'node:path';

import { resolveFeishuFrameworkAllowFromPath } from './paths.js';

type AllowFromFileContent = {
  version: number;
  allowFrom: Array<string | number>;
};

export function readFrameworkAllowFromList(accountId: string): Array<string | number> {
  const filePath = resolveFeishuFrameworkAllowFromPath(accountId);
  try {
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as AllowFromFileContent;
    if (Array.isArray(parsed.allowFrom)) {
      return parsed.allowFrom.filter(
        (id): id is string | number =>
          (typeof id === 'string' && id.trim() !== '') || (typeof id === 'number' && Number.isFinite(id)),
      );
    }
  } catch {
    // best-effort
  }
  return [];
}

export async function registerUserInFrameworkStore(params: {
  accountId: string;
  userId: string | number;
}): Promise<{ changed: boolean }> {
  const { accountId, userId } = params;
  const normalized = typeof userId === 'number' ? userId : userId.trim();
  if (typeof normalized === 'string' && !normalized) return { changed: false };

  const filePath = resolveFeishuFrameworkAllowFromPath(accountId);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

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

  if (content.allowFrom.some((x) => String(x) === String(normalized))) {
    return { changed: false };
  }

  content.allowFrom.push(normalized);
  fs.writeFileSync(filePath, JSON.stringify(content, null, 2), 'utf-8');
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // best-effort
  }
  return { changed: true };
}


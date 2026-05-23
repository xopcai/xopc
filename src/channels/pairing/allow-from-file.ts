import fs from 'node:fs';
import path from 'node:path';

type AllowFromFileContent = {
  version: number;
  allowFrom: string[];
};

function readAllowFromFile(filePath: string): AllowFromFileContent {
  try {
    if (!fs.existsSync(filePath)) return { version: 1, allowFrom: [] };
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as AllowFromFileContent;
    if (Array.isArray(parsed.allowFrom)) {
      return {
        version: 1,
        allowFrom: parsed.allowFrom.filter((id): id is string => typeof id === 'string' && id.trim() !== ''),
      };
    }
  } catch {
    /* best-effort */
  }
  return { version: 1, allowFrom: [] };
}

export function readAllowFromIdsSync(filePath: string): string[] {
  return readAllowFromFile(filePath).allowFrom;
}

export function appendAllowFromIdSync(filePath: string, userId: string): { changed: boolean } {
  const trimmed = userId.trim();
  if (!trimmed) return { changed: false };

  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });

  const content = readAllowFromFile(filePath);
  if (content.allowFrom.includes(trimmed)) {
    return { changed: false };
  }

  content.allowFrom.push(trimmed);
  fs.writeFileSync(filePath, JSON.stringify(content, null, 2), 'utf-8');
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    /* ignore */
  }
  return { changed: true };
}

export function removeAllowFromIdSync(filePath: string, userId: string): { changed: boolean } {
  const trimmed = userId.trim();
  if (!trimmed) return { changed: false };

  const content = readAllowFromFile(filePath);
  const next = content.allowFrom.filter((id) => id !== trimmed);
  if (next.length === content.allowFrom.length) {
    return { changed: false };
  }

  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({ version: 1, allowFrom: next }, null, 2), 'utf-8');
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    /* ignore */
  }
  return { changed: true };
}

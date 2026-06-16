import { readFileSync } from 'node:fs';

/** Resolve bot token from inline value or tokenFile path. */
export function resolveTelegramBotToken(params: {
  botToken?: string;
  tokenFile?: string;
}): { token: string; source: 'inline' | 'file' | 'none' } {
  const inline = params.botToken?.trim() ?? '';
  if (inline) {
    return { token: inline, source: 'inline' };
  }
  const filePath = params.tokenFile?.trim();
  if (!filePath) {
    return { token: '', source: 'none' };
  }
  try {
    const raw = readFileSync(filePath, 'utf8').trim();
    return raw ? { token: raw, source: 'file' } : { token: '', source: 'none' };
  } catch {
    return { token: '', source: 'none' };
  }
}

import { homedir } from 'node:os';

/** Expand leading `~` to the user home directory (OpenClaw-style path strings). */
export function expandWorkspacePathString(raw: string): string {
  const s = raw.trim();
  if (s.startsWith('~')) {
    return s.replace(/^~(?=$|[/\\])/, homedir());
  }
  return s;
}

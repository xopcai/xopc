/**
 * Bounded curated memory: `.xopcbot/memories/MEMORY.md` + `USER.md`, §-delimited entries.
 * Snapshot for system prompt is captured at load time and not mutated until next load.
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import lockfile from 'proper-lockfile';

import type { MemorySnapshot, MemoryStoreConfig } from './types.js';

export const MEMORY_ENTRY_DELIMITER = '\n§\n';

const DEFAULT_MEMORY_LIMIT = 2200;
const DEFAULT_USER_LIMIT = 1375;

export class BuiltinMemoryStore {
  private memoryEntries: string[] = [];
  private userEntries: string[] = [];
  private snapshot: MemorySnapshot = { memory: '', user: '' };

  constructor(private readonly config: MemoryStoreConfig) {}

  private get memDir(): string {
    return join(this.config.workspaceDir, '.xopcbot', 'memories');
  }

  pathFor(target: 'memory' | 'user'): string {
    return join(this.memDir, target === 'memory' ? 'MEMORY.md' : 'USER.md');
  }

  /**
   * Load from disk and freeze {@link getSnapshot}. Sync for agent creation (prefix cache stability).
   */
  loadFromDiskSync(): void {
    mkdirSync(this.memDir, { recursive: true });
    this.memoryEntries = this.parseFileContent(
      this.readPathSync(join(this.memDir, 'MEMORY.md')),
    );
    this.userEntries = this.parseFileContent(this.readPathSync(join(this.memDir, 'USER.md')));
    this.memoryEntries = dedupePreserveOrder(this.memoryEntries);
    this.userEntries = dedupePreserveOrder(this.userEntries);
    this.snapshot = {
      memory: this.renderBlock('memory', this.memoryEntries),
      user: this.renderBlock('user', this.userEntries),
    };
  }

  private readPathSync(path: string): string {
    try {
      if (!existsSync(path)) return '';
      return readFileSync(path, { encoding: 'utf-8' });
    } catch {
      return '';
    }
  }

  private parseFileContent(raw: string): string[] {
    if (!raw.trim()) return [];
    return raw
      .split(MEMORY_ENTRY_DELIMITER)
      .map((e) => e.trim())
      .filter(Boolean);
  }

  getSnapshot(): MemorySnapshot {
    return this.snapshot;
  }

  /**
   * Live entries for read/debug (may differ from snapshot after mutations).
   */
  getLiveEntries(target: 'memory' | 'user'): string[] {
    return target === 'memory' ? [...this.memoryEntries] : [...this.userEntries];
  }

  async add(
    target: 'memory' | 'user',
    content: string,
  ): Promise<{ success: boolean; error?: string; message?: string }> {
    const trimmed = content.trim();
    if (!trimmed) {
      return { success: false, error: 'Content cannot be empty.' };
    }
    const scanError = scanForThreats(trimmed);
    if (scanError) {
      return { success: false, error: scanError };
    }

    return this.withFileLock(target, async () => {
      await this.reloadTargetFromDisk(target);
      const entries = target === 'memory' ? this.memoryEntries : this.userEntries;
      const limit = this.charLimit(target);

      if (entries.includes(trimmed)) {
        return { success: false, error: 'Entry already exists' };
      }

      const newTotal = calculateTotal([...entries, trimmed]);
      if (newTotal > limit) {
        return {
          success: false,
          error: `Memory at ${calculateTotal(entries)}/${limit} chars. Adding would exceed limit.`,
        };
      }

      entries.push(trimmed);
      await this.flushTargetToDisk(target);
      return { success: true, message: 'Entry added.' };
    });
  }

  async replace(
    target: 'memory' | 'user',
    oldText: string,
    newContent: string,
  ): Promise<{ success: boolean; error?: string; message?: string }> {
    const ot = oldText.trim();
    const nc = newContent.trim();
    if (!ot) {
      return { success: false, error: 'old_text cannot be empty.' };
    }
    if (!nc) {
      return { success: false, error: 'new_content cannot be empty. Use remove to delete entries.' };
    }
    const scanError = scanForThreats(nc);
    if (scanError) {
      return { success: false, error: scanError };
    }

    return this.withFileLock(target, async () => {
      await this.reloadTargetFromDisk(target);
      const entries = target === 'memory' ? this.memoryEntries : this.userEntries;
      const matches: Array<{ index: number; entry: string }> = [];
      for (let i = 0; i < entries.length; i++) {
        if (entries[i].includes(ot)) {
          matches.push({ index: i, entry: entries[i] });
        }
      }

      if (matches.length === 0) {
        return { success: false, error: `No entry matched '${ot}'.` };
      }

      if (matches.length > 1) {
        const uniqueTexts = new Set(matches.map((m) => m.entry));
        if (uniqueTexts.size > 1) {
          const previews = matches.map((m) =>
            m.entry.length > 80 ? `${m.entry.slice(0, 80)}...` : m.entry,
          );
          return {
            success: false,
            error: `Multiple entries matched '${ot}'. Be more specific. Previews: ${previews.join(' | ')}`,
          };
        }
      }

      const idx = matches[0].index;
      const limit = this.charLimit(target);
      const testEntries = [...entries];
      testEntries[idx] = nc;

      if (calculateTotal(testEntries) > limit) {
        return {
          success: false,
          error: `Replacement would put memory at ${calculateTotal(testEntries)}/${limit} chars.`,
        };
      }

      entries[idx] = nc;
      await this.flushTargetToDisk(target);
      return { success: true, message: 'Entry replaced.' };
    });
  }

  async remove(
    target: 'memory' | 'user',
    oldText: string,
  ): Promise<{ success: boolean; error?: string; message?: string }> {
    const ot = oldText.trim();
    if (!ot) {
      return { success: false, error: 'old_text cannot be empty.' };
    }

    return this.withFileLock(target, async () => {
      await this.reloadTargetFromDisk(target);
      const entries = target === 'memory' ? this.memoryEntries : this.userEntries;
      const matches: number[] = [];
      for (let i = 0; i < entries.length; i++) {
        if (entries[i].includes(ot)) {
          matches.push(i);
        }
      }

      if (matches.length === 0) {
        return { success: false, error: `No entry matched '${ot}'.` };
      }

      if (matches.length > 1) {
        const uniqueTexts = new Set(matches.map((i) => entries[i]));
        if (uniqueTexts.size > 1) {
          const previews = matches.map((i) => {
            const e = entries[i];
            return e.length > 80 ? `${e.slice(0, 80)}...` : e;
          });
          return {
            success: false,
            error: `Multiple entries matched '${ot}'. Be more specific. Previews: ${previews.join(' | ')}`,
          };
        }
      }

      entries.splice(matches[0], 1);
      await this.flushTargetToDisk(target);
      return { success: true, message: 'Entry removed.' };
    });
  }

  private async withFileLock<T>(
    target: 'memory' | 'user',
    fn: () => Promise<T>,
  ): Promise<T> {
    const filePath = this.pathFor(target);
    await mkdir(this.memDir, { recursive: true });
    if (!existsSync(filePath)) {
      await writeFile(filePath, '', 'utf-8');
    }
    await lockfile.lock(filePath, { retries: 3, stale: 10_000 });
    try {
      return await fn();
    } finally {
      await lockfile.unlock(filePath);
    }
  }

  private async reloadTargetFromDisk(target: 'memory' | 'user'): Promise<void> {
    const path = this.pathFor(target);
    let raw = '';
    try {
      raw = await readFile(path, 'utf-8');
    } catch {
      raw = '';
    }
    const parsed = dedupePreserveOrder(this.parseFileContent(raw));
    if (target === 'memory') {
      this.memoryEntries = parsed;
    } else {
      this.userEntries = parsed;
    }
  }

  private async flushTargetToDisk(target: 'memory' | 'user'): Promise<void> {
    const entries = target === 'memory' ? this.memoryEntries : this.userEntries;
    const filePath = this.pathFor(target);
    const content = entries.join(MEMORY_ENTRY_DELIMITER);
    const tmpPath = `${filePath}.tmp.${Date.now()}`;
    await writeFile(tmpPath, content, 'utf-8');
    await rename(tmpPath, filePath);
  }

  private charLimit(target: 'memory' | 'user'): number {
    return target === 'memory'
      ? (this.config.memoryCharLimit ?? DEFAULT_MEMORY_LIMIT)
      : (this.config.userCharLimit ?? DEFAULT_USER_LIMIT);
  }

  private renderBlock(target: 'memory' | 'user', entries: string[]): string {
    if (entries.length === 0) {
      return '';
    }

    const limit = this.charLimit(target);
    const content = entries.join(MEMORY_ENTRY_DELIMITER);
    const current = content.length;
    const pct = Math.min(100, Math.round((current / limit) * 100));

    const header =
      target === 'user'
        ? `USER PROFILE (who the user is) [${pct}% — ${current.toLocaleString()}/${limit.toLocaleString()} chars]`
        : `MEMORY (your personal notes) [${pct}% — ${current.toLocaleString()}/${limit.toLocaleString()} chars]`;

    const separator = '═'.repeat(46);
    return `${separator}\n${header}\n${separator}\n${content}`;
  }
}

function dedupePreserveOrder(entries: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of entries) {
    if (seen.has(e)) {
      continue;
    }
    seen.add(e);
    out.push(e);
  }
  return out;
}

function calculateTotal(entries: string[]): number {
  if (entries.length === 0) {
    return 0;
  }
  return entries.join(MEMORY_ENTRY_DELIMITER).length;
}

export function scanForThreats(content: string): string | null {
  const patterns: Array<{ regex: RegExp; id: string }> = [
    { regex: /ignore\s+(previous|all|above|prior)\s+instructions/i, id: 'prompt_injection' },
    { regex: /you\s+are\s+now\s+/i, id: 'role_hijack' },
    { regex: /do\s+not\s+tell\s+the\s+user/i, id: 'deception_hide' },
    { regex: /system\s+prompt\s+override/i, id: 'sys_prompt_override' },
    {
      regex: /disregard\s+(your|all|any)\s+(instructions|rules|guidelines)/i,
      id: 'disregard_rules',
    },
    {
      regex: /act\s+as\s+(if|though)\s+you\s+(have\s+no|don't\s+have)\s+(restrictions|limits|rules)/i,
      id: 'bypass_restrictions',
    },
    { regex: /curl\s+[^\n]*\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)/i, id: 'exfil_curl' },
    { regex: /wget\s+[^\n]*\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)/i, id: 'exfil_wget' },
    {
      regex: /cat\s+[^\n]*(\.env|credentials|\.netrc|\.pgpass|\.npmrc|\.pypirc)/i,
      id: 'read_secrets',
    },
    { regex: /authorized_keys/i, id: 'ssh_backdoor' },
    { regex: /\$HOME\/\.ssh|\~\/\.ssh/i, id: 'ssh_access' },
  ];

  for (const { regex, id } of patterns) {
    if (regex.test(content)) {
      return `Blocked: content matches threat pattern '${id}'. Memory entries are injected into the system prompt and must not contain injection payloads.`;
    }
  }

  const invisibleChars = [
    '\u200b',
    '\u200c',
    '\u200d',
    '\u2060',
    '\ufeff',
    '\u202a',
    '\u202b',
    '\u202c',
    '\u202d',
    '\u202e',
  ];
  for (const char of invisibleChars) {
    if (content.includes(char)) {
      const code = char.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0');
      return `Blocked: content contains invisible unicode character U+${code} (possible injection).`;
    }
  }

  return null;
}

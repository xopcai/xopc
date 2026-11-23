import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  collectAiInstructionItems,
  collectChromiumBookmarkItems,
  collectLocalMarkdownNoteItems,
  collectObsidianItems,
  collectRecentFileItems,
  previewTier1Sources,
  sanitizeBookmarkUrl,
} from '../index.js';

describe('Tier 1 understanding source collectors', () => {
  it('collects global user AI instructions and ignores secrets', async () => {
    const home = await mkdtemp(join(tmpdir(), 'xopc-ai-rules-'));
    await mkdir(join(home, '.claude', 'rules'), { recursive: true });
    await mkdir(join(home, '.codex'), { recursive: true });
    await writeFile(join(home, '.claude', 'CLAUDE.md'), '# Style\nPrefer concise Chinese replies with English technical terms.');
    await writeFile(join(home, '.claude', 'rules', 'writing.md'), 'Always lead with conclusions and avoid filler.');
    await writeFile(join(home, '.claude', 'rules', 'api-keys.md'), 'SECRET=1234567890');
    await writeFile(join(home, '.codex', 'AGENTS.md'), '# Agent rules\nKeep responses structured with crisp tables.');

    const items = await collectAiInstructionItems({ homeDirectory: home });
    expect(items).toHaveLength(3);
    expect(items.every((item) => item.ownerAttribution === 'user')).toBe(true);
    expect(items.some((item) => item.title.includes('api-keys'))).toBe(false);
  });

  it('collects Obsidian notes, marks clippings as other, and skips templates', async () => {
    const home = await mkdtemp(join(tmpdir(), 'xopc-obsidian-'));
    const vault = join(home, 'MyVault');
    await mkdir(join(home, 'Library', 'Application Support', 'obsidian'), { recursive: true });
    await mkdir(join(vault, '.obsidian'), { recursive: true });
    await mkdir(join(vault, 'Templates'), { recursive: true });
    await mkdir(join(vault, 'Clippings'), { recursive: true });
    await writeFile(
      join(home, 'Library', 'Application Support', 'obsidian', 'obsidian.json'),
      JSON.stringify({ vaults: { v1: { path: vault, ts: Date.now() } } }),
    );
    await writeFile(join(vault, 'Q4 Strategy.md'), '# Q4 Strategy\nWe focus on [[Desktop Experience]] and local-first privacy.\n\n1. Lead with clear milestones.');
    await writeFile(join(vault, 'Desktop Experience.md'), '# Desktop Experience\nFast startup, calm slate neutrals, zero permission popups on first screen.');
    await writeFile(join(vault, 'Templates', 'Daily.md'), '# {{date}}\n- Tasks');
    await writeFile(join(vault, 'Clippings', 'External Article.md'), '---\nurl: https://example.com/post\n---\nAn external blog post written by someone else.');
    await writeFile(join(vault, 'Clipped Note.md'), '---\nsource: https://news.example.com\nauthor: Jane\n---\nAnother clipped article with enough content to pass length filter.');

    const items = await collectObsidianItems({ homeDirectory: home, platform: 'darwin' });
    const byTitle = new Map(items.map((item) => [item.title, item]));
    expect(byTitle.has('Q4 Strategy')).toBe(true);
    expect(byTitle.get('Q4 Strategy')?.ownerAttribution).toBe('user');
    expect(byTitle.has('Daily')).toBe(false);
    expect(byTitle.get('External Article')?.ownerAttribution).toBe('other');
    expect(byTitle.get('Clipped Note')?.ownerAttribution).toBe('other');
  });

  it('collects local markdown notes including custom directories and skips Obsidian vaults', async () => {
    const home = await mkdtemp(join(tmpdir(), 'xopc-local-notes-'));
    const notesDir = join(home, 'Notes');
    const customDir = join(home, 'CustomNotes');
    await mkdir(notesDir, { recursive: true });
    await mkdir(customDir, { recursive: true });
    await writeFile(join(notesDir, 'weekly.md'), '# Weekly Reflection\nFocus on deep work blocks every morning before noon.');
    await writeFile(join(customDir, 'essay.md'), '# Product Essay\nGreat tools reduce cognitive friction rather than adding wizards.');

    const items = await collectLocalMarkdownNoteItems({
      homeDirectory: home,
      platform: 'darwin',
      customDirectories: [customDir],
    });
    expect(items.map((item) => item.title).sort()).toEqual(['essay', 'weekly']);
    expect(items.every((item) => item.ownerAttribution === 'user')).toBe(true);
  });

  it('assigns accurate ownerAttribution for recent files (Documents authored vs Downloads)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'xopc-recent-files-'));
    await mkdir(join(home, 'Documents'), { recursive: true });
    await mkdir(join(home, 'Downloads'), { recursive: true });
    await writeFile(join(home, 'Documents', 'My Spec.md'), '# Spec\nUser-authored technical specification.');
    await writeFile(join(home, 'Downloads', 'Vendor Brochure.md'), '# Brochure\nDownloaded external file.');

    const items = await collectRecentFileItems({ homeDirectory: home, platform: 'darwin' });
    const spec = items.find((item) => item.title === 'My Spec.md');
    const downloaded = items.find((item) => item.title === 'Vendor Brochure.md');
    expect(spec?.ownerAttribution).toBe('user');
    expect(downloaded?.ownerAttribution).toBe('unknown');
  });

  it('sanitizes bookmark URLs and collects Chrome/Arc bookmarks while skipping sensitive domains', async () => {
    expect(sanitizeBookmarkUrl('https://docs.example.com/secret/path?token=abc#hash')).toBe('https://docs.example.com');
    expect(sanitizeBookmarkUrl('http://localhost:3000/admin')).toBeNull();
    expect(sanitizeBookmarkUrl('https://mybank.example.com/login')).toBeNull();

    const home = await mkdtemp(join(tmpdir(), 'xopc-bookmarks-'));
    const arcProfile = join(home, 'Library', 'Application Support', 'Arc', 'User Data', 'Default');
    await mkdir(arcProfile, { recursive: true });
    const nowMicros = String((Date.now() + 11_644_473_600_000) * 1_000);
    await writeFile(join(arcProfile, 'Bookmarks'), JSON.stringify({
      roots: {
        bookmark_bar: {
          type: 'folder',
          name: 'Work',
          children: [
            { type: 'url', name: 'TypeScript Handbook', url: 'https://www.typescriptlang.org/docs?ref=1', date_added: nowMicros },
            { type: 'url', name: 'Local Admin', url: 'http://127.0.0.1:8080/secret', date_added: nowMicros },
          ],
        },
      },
    }));

    const items = await collectChromiumBookmarkItems({ homeDirectory: home, platform: 'darwin' });
    expect(items).toHaveLength(1);
    expect(items[0]?.title).toBe('TypeScript Handbook');
    expect(items[0]?.resourceUri).toBe('https://www.typescriptlang.org');
  });

  it('previews all Tier 1 sources without throwing when empty', async () => {
    const home = await mkdtemp(join(tmpdir(), 'xopc-preview-empty-'));
    const previews = await previewTier1Sources({ homeDirectory: home, platform: 'darwin' });
    expect(previews).toHaveLength(5);
    expect(previews.every((preview) => preview.detected === false)).toBe(true);
  });
});

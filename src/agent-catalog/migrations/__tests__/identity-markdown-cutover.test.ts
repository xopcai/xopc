import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveAgentProfileDir } from '../../../agent/agent-scope.js';
import { closeXopcDatabase, openXopcDatabase } from '../../../storage/sqlite/index.js';
import { AgentCatalogRepository } from '../../repository.js';
import { migrateIdentityMarkdownToCatalog, parseIdentityFieldsForCutover } from '../identity-markdown-cutover.js';

describe('Agent identity cutover', () => {
  let stateDir: string;
  let previousStateDir: string | undefined;

  beforeEach(() => {
    previousStateDir = process.env.XOPC_STATE_DIR;
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-identity-cutover-'));
    process.env.XOPC_STATE_DIR = stateDir;
    closeXopcDatabase();
    openXopcDatabase({ path: ':memory:' });
    new AgentCatalogRepository().ensureInitialized();
  });

  afterEach(() => {
    closeXopcDatabase();
    if (previousStateDir === undefined) delete process.env.XOPC_STATE_DIR;
    else process.env.XOPC_STATE_DIR = previousStateDir;
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('recognizes English and Chinese labels in existing identity files', () => {
    expect(parseIdentityFieldsForCutover('- **Name:** Nova\n- **Description:** Research partner\n- **Avatar:** xopc:custom'))
      .toEqual({ name: 'Nova', description: 'Research partner', avatar: 'xopc:custom' });
    expect(parseIdentityFieldsForCutover('- **名称：** 小助\n- **角色：** 研究伙伴\n- **语言：** 中文\n- **风格：** 温和'))
      .toEqual({ name: '小助', creature: '研究伙伴', language: '中文', style: '温和' });
  });

  it('imports fields without overwriting the catalog name and archives the source once', () => {
    const repository = new AgentCatalogRepository();
    repository.create({ id: 'coder', profile: { name: 'My Coder', instructions: 'Keep changes small.' } }, { ready: true });
    const profileDir = resolveAgentProfileDir('coder');
    mkdirSync(profileDir, { recursive: true });
    const source = join(profileDir, 'IDENTITY.md');
    const content = '- **Name:** File Coder\n- **Description:** Code specialist\n- **Language:** 中文\n- **Vibe:** Direct\n- **Emoji:** 💻\n\nCustom notes.';
    writeFileSync(source, content);

    migrateIdentityMarkdownToCatalog();

    expect(repository.get('coder')?.profile).toEqual({
      name: 'My Coder', description: 'Code specialist', language: '中文', style: 'Direct', emoji: '💻',
      instructions: 'Keep changes small.',
    });
    expect(existsSync(source)).toBe(false);
    expect(readFileSync(join(profileDir, '.identity-migration-backup'), 'utf8')).toBe(content);
    migrateIdentityMarkdownToCatalog();
    expect(repository.get('coder')?.profile?.name).toBe('My Coder');
  });
});

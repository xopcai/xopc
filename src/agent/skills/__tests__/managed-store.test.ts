import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import AdmZip from 'adm-zip';
import { afterEach, describe, it, expect } from 'vitest';

import { resolveSkillsDir } from '../../../config/paths.js';
import {
  deleteManagedSkill,
  installSkillFromZip,
  isIgnorableZipEntry,
  isManagedSkillTransientDirName,
  isValidSkillId,
  MAX_SKILL_ZIP_BYTES,
} from '../managed-store.js';

describe('managed-store', () => {
  const stateDirs: string[] = [];
  const previousStateDir = process.env.XOPC_STATE_DIR;

  afterEach(() => {
    if (previousStateDir === undefined) delete process.env.XOPC_STATE_DIR;
    else process.env.XOPC_STATE_DIR = previousStateDir;
    for (const dir of stateDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function useTempStateDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'xopc-managed-store-'));
    stateDirs.push(dir);
    process.env.XOPC_STATE_DIR = dir;
    return dir;
  }

  function makeSkillZip(id: string): Buffer {
    const zip = new AdmZip();
    zip.addFile(
      `${id}/SKILL.md`,
      Buffer.from(`---\nname: ${id}\ndescription: ${id} skill\n---\n\nUse this skill.\n`),
    );
    return zip.toBuffer();
  }

  it('validates skill ids', () => {
    expect(isValidSkillId('a')).toBe(true);
    expect(isValidSkillId('my-skill_1')).toBe(true);
    expect(isValidSkillId('')).toBe(false);
    expect(isValidSkillId('-bad')).toBe(false);
    expect(isValidSkillId('a'.repeat(63))).toBe(true);
    expect(isValidSkillId('a'.repeat(64))).toBe(false);
  });

  it('exports zip size limit', () => {
    expect(MAX_SKILL_ZIP_BYTES).toBeGreaterThan(1024 * 1024);
  });

  it('ignores macOS / junk zip paths', () => {
    expect(isIgnorableZipEntry('__MACOSX/pdf/SKILL.md')).toBe(true);
    expect(isIgnorableZipEntry('pdf/.DS_Store')).toBe(true);
    expect(isIgnorableZipEntry('pdf/._SKILL.md')).toBe(true);
    expect(isIgnorableZipEntry('pdf/SKILL.md')).toBe(false);
  });

  it('installs zip through a transient directory and exposes only the final skill', () => {
    useTempStateDir();

    const result = installSkillFromZip(makeSkillZip('demo-skill'), {});
    const entries = readdirSync(resolveSkillsDir());

    expect(result.skillId).toBe('demo-skill');
    expect(entries).toEqual(['demo-skill']);
    expect(entries.some(isManagedSkillTransientDirName)).toBe(false);
  });

  it('deletes through a transient trash directory and removes the final skill', () => {
    useTempStateDir();
    installSkillFromZip(makeSkillZip('demo-skill'), {});

    deleteManagedSkill('demo-skill');

    expect(readdirSync(resolveSkillsDir())).toEqual([]);
  });
});

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadSkills } from '../index.js';

const bundledSkillsDir = join(process.cwd(), 'skills');

describe('bundled capability packs', () => {
  const isolatedStateDir = mkdtempSync(join(tmpdir(), 'xopc-bundled-packs-'));
  let previousStateDir: string | undefined;

  beforeAll(() => {
    previousStateDir = process.env.XOPC_STATE_DIR;
    process.env.XOPC_STATE_DIR = isolatedStateDir;
  });

  afterAll(() => {
    if (previousStateDir === undefined) delete process.env.XOPC_STATE_DIR;
    else process.env.XOPC_STATE_DIR = previousStateDir;
    rmSync(isolatedStateDir, { recursive: true, force: true });
  });

  it('loads the approved built-in packs with their intended tool gates', () => {
    const result = loadSkills({
      builtinDir: bundledSkillsDir,
      agentsDir: join(isolatedStateDir, 'agents-skills'),
    });
    const byName = new Map(result.skills.map((skill) => [skill.name, skill]));

    expect([...byName.keys()]).toEqual(expect.arrayContaining([
      'define-task',
      'pdf',
      'docx',
      'pptx',
      'doc-coauthoring',
    ]));
    expect(byName.get('pdf')?.toolConditions?.requiresTools).toEqual([
      'read_file',
      'write_file',
      'exec_command',
    ]);
    expect(byName.get('define-task')?.toolConditions?.requiresTools).toEqual([
      'xopc_use',
      'tool_manual',
    ]);
    expect(byName.get('xlsx')?.toolConditions?.requiresTools).toEqual([
      'read_file',
      'write_file',
      'exec_command',
    ]);
    expect(byName.get('find-skills')?.toolConditions?.requiresTools).toEqual([
      'skills_marketplace_search',
    ]);
    expect(byName.get('build-xopc-local-app')?.metadata.xopc?.activatesCapabilities).toEqual([
      'extension-authoring',
    ]);
    expect(byName.has('algorithmic-art')).toBe(false);
  });

  it('ships a provenance notice without restricted reference material', () => {
    const notice = join(bundledSkillsDir, 'THIRD_PARTY_NOTICES.md');

    expect(existsSync(notice)).toBe(true);
    expect(readFileSync(notice, 'utf8')).toContain('clean-room');
  });

  it('ships executable resources and references alongside the capability packs', () => {
    const resources = [
      'documents/pdf/scripts/inspect_pdf.py',
      'documents/pdf/scripts/render_pdf.py',
      'documents/docx/scripts/inspect_ooxml.py',
      'documents/docx/scripts/render_docx.py',
      'documents/pptx/scripts/inspect_ooxml.py',
      'documents/pptx/scripts/render_pptx.py',
      'engineering/define-task/references/task-contract-rubric.md',
    ];

    for (const resource of resources) {
      expect(existsSync(join(bundledSkillsDir, resource))).toBe(true);
    }
  });
});

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadSkills } from '../index.js';

const bundledSkillsDir = join(process.cwd(), 'skills');

describe('bundled capability packs', () => {
  it('loads the approved built-in packs with their intended tool gates', () => {
    const result = loadSkills({ builtinDir: bundledSkillsDir });
    const byName = new Map(result.skills.map((skill) => [skill.name, skill]));

    expect([...byName.keys()]).toEqual(expect.arrayContaining([
      'define-task',
      'pdf',
      'docx',
      'pptx',
      'doc-coauthoring',
      'algorithmic-art',
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
    expect(byName.get('algorithmic-art')?.toolConditions?.requiresTools).toEqual([
      'write_file',
      'image_generate',
    ]);
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
      'creative/algorithmic-art/templates/viewer.html',
      'creative/algorithmic-art/templates/generator-template.js',
      'engineering/define-task/references/task-contract-rubric.md',
    ];

    for (const resource of resources) {
      expect(existsSync(join(bundledSkillsDir, resource))).toBe(true);
    }
  });
});

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
export const PreviewFixturesSchema = z.strictObject({
  schemaVersion: z.literal(1),
  notes: z.array(z.strictObject({ id, title: z.string().max(1000), markdown: z.string().max(64_000),
    tags: z.array(z.string().max(100)).max(20).default([]) })).max(50),
  tasks: z.array(z.strictObject({ id, title: z.string().max(500), phase: z.enum(['backlog', 'ready']).default('backlog') })).max(50),
}).refine(value => new Set(value.notes.map(note => note.id)).size === value.notes.length
  && new Set(value.tasks.map(task => task.id)).size === value.tasks.length, 'Duplicate fixture ID');
export type PreviewFixtures = z.infer<typeof PreviewFixturesSchema>;

export function readPreviewFixtures(root: string): PreviewFixtures {
  const path = join(root, '.xopc', 'fixtures.json');
  if (existsSync(path)) {
    const content = readFileSync(path);
    if (content.byteLength > 256_000) throw new Error('Preview fixtures exceed 256 KB');
    return PreviewFixturesSchema.parse(JSON.parse(content.toString('utf8')));
  }
  return PreviewFixturesSchema.parse({ schemaVersion: 1,
    notes: [
      { id: 'sample-note-reading', title: '示例：阅读清单 / Reading list', markdown: '这是一条示例笔记，不包含真实数据。\n\n- [ ] Read an article', tags: ['sample'] },
      { id: 'sample-note-review', title: '示例：每周复盘 / Weekly review', markdown: '## 本周成果\n完成第一个小工具。\n\n## 下周计划\n试用并调整。', tags: ['sample'] },
    ],
    tasks: [{ id: 'sample-task-plan', title: '示例：准备本周计划 / Plan the week', phase: 'ready' },
      { id: 'sample-task-review', title: '示例：整理复盘 / Review progress', phase: 'backlog' }],
  });
}

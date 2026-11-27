import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSkillsListTool } from '../../tools/skills-tools.js';
import { SkillManager } from '../skill-manager.js';
import { SkillSearchIndex, tokenizeSkillText } from '../skill-search.js';
import type { Skill, SkillOrigin } from '../types.js';

function makeOrigin(id: SkillOrigin['id'], priority: number, scope: SkillOrigin['scope']): SkillOrigin {
  return {
    id,
    rootDir: `/tmp/${id}`,
    priority,
    scope,
    managed: false,
    writable: false,
  };
}

function makeSkill(overrides: Partial<Skill> & Pick<Skill, 'name' | 'description'>): Skill {
  return {
    filePath: `/tmp/skills/${overrides.name}/SKILL.md`,
    baseDir: `/tmp/skills/${overrides.name}`,
    source: 'global',
    origin: makeOrigin('xopc-global', 400, 'global'),
    disableModelInvocation: false,
    metadata: { name: overrides.name, description: overrides.description },
    content: '',
    ...overrides,
  };
}

describe('tokenizeSkillText', () => {
  it('splits camelCase, kebab-case, and generates Han bigrams', () => {
    const tokens = tokenizeSkillText('k8sCanary-rollback 生产部署回滚');
    expect(tokens).toContain('k8s');
    expect(tokens).toContain('canary');
    expect(tokens).toContain('rollback');
    expect(tokens).toContain('生产');
    expect(tokens).toContain('部署');
    expect(tokens).toContain('回滚');
  });
});

describe('SkillSearchIndex', () => {
  const skills: Skill[] = [
    makeSkill({
      name: 'k8s-canary-rollback',
      description: 'Safely rollback Kubernetes canary deployments when error rates spike.',
      category: 'devops',
      tags: ['kubernetes', 'argo', 'rollback'],
      headings: ['Preflight Health Checks', 'Rollback Commands'],
    }),
    makeSkill({
      name: 'meeting-to-actions',
      description: 'Convert meeting transcripts into owner-assigned action items.',
      category: 'productivity',
      localizations: {
        'zh-CN': {
          displayName: '会议行动闭环',
          description: '从会议纪要中提取负责人和截止时间的行动项。',
        },
      },
      headings: ['提取行动项', 'Owner Assignment'],
    }),
    makeSkill({
      name: 'poster-designer',
      description: 'Create visual posters and layout briefs.',
      category: 'design',
      tags: ['poster', 'layout', '海报'],
      headings: ['Typography Rules', 'Color Contrast'],
    }),
    makeSkill({
      name: 'plain-helper',
      description: 'General helper without category.',
    }),
  ];

  it('ranks exact name and multi-word BM25 matches accurately', () => {
    const index = new SkillSearchIndex(skills);
    const res = index.search(skills, { query: 'kubernetes rollback' });
    expect(res.total).toBe(1);
    expect(res.hits[0].skill.name).toBe('k8s-canary-rollback');
    expect(res.hits[0].matchedOn).toContain('name');
  });

  it('recalls skills using Chinese queries against zh-CN localizations and tags', () => {
    const index = new SkillSearchIndex(skills);

    const meetingRes = index.search(skills, { query: '会议纪要 提取行动项' });
    expect(meetingRes.hits[0]?.skill.name).toBe('meeting-to-actions');

    const posterRes = index.search(skills, { query: '设计海报' });
    expect(posterRes.hits[0]?.skill.name).toBe('poster-designer');
  });

  it('recalls skills via SKILL.md headings even when description does not contain the term', () => {
    const index = new SkillSearchIndex(skills);
    const res = index.search(skills, { query: 'Color Contrast' });
    expect(res.hits[0]?.skill.name).toBe('poster-designer');
    expect(res.hits[0]?.matchedOn).toContain('headings');
  });

  it('filters by category including uncategorized and paginates deterministically', () => {
    const index = new SkillSearchIndex(skills);

    const uncat = index.search(skills, { category: 'uncategorized' });
    expect(uncat.hits.map((h) => h.skill.name)).toEqual(['plain-helper']);

    const page1 = index.search(skills, { limit: 2, offset: 0 });
    expect(page1.total).toBe(4);
    expect(page1.returned).toBe(2);
    expect(page1.hasMore).toBe(true);
    expect(page1.categories).toHaveLength(4);

    const page2 = index.search(skills, { limit: 2, offset: 2 });
    expect(page2.returned).toBe(2);
    expect(page2.hasMore).toBe(false);
  });
});

describe('createSkillsListTool with SkillManager', () => {
  const roots: string[] = [];

  afterEach(() => {
    vi.unstubAllEnvs();
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('paginates large skill sets and searches localized + heading fields', async () => {
    const root = mkdtempSync(join(tmpdir(), 'xopc-skills-list-'));
    roots.push(root);
    vi.stubEnv('XOPC_STATE_DIR', root);

    for (let i = 0; i < 25; i++) {
      const dir = join(root, '.xopc', 'skills', i < 12 ? 'devops' : 'writing', `skill-${String(i).padStart(2, '0')}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, 'SKILL.md'),
        `---\nname: skill-${String(i).padStart(2, '0')}\ndescription: Standard skill ${i}\n---\n\n# Guide ${i}\n`,
      );
    }

    const cnDir = join(root, '.xopc', 'skills', 'ops', 'incident-drill');
    mkdirSync(cnDir, { recursive: true });
    writeFileSync(
      join(cnDir, 'SKILL.md'),
      `---
name: incident-drill
description: Run production incident response drills.
tags:
  - sre
  - oncall
metadata:
  i18n:
    zh-CN:
      name: 故障演练手册
      description: 组织线上故障应急响应与复盘演练。
---

# Incident Playbook

## 混沌工程注入步骤
`,
    );

    const manager = new SkillManager(root, join(root, 'bundled'));
    const tool = createSkillsListTool({
      getSkillManager: () => manager,
      getSkillIndexingContext: () => ({ registeredToolNames: ['skills_list', 'skill_view'] }),
    });

    const browseRes = await tool.execute('call-browse', {});
    const browsePayload = JSON.parse((browseRes.content[0] as { text: string }).text);
    expect(browsePayload.total).toBeGreaterThanOrEqual(26);
    expect(browsePayload.returned).toBe(20);
    expect(browsePayload.hasMore).toBe(true);
    expect(browsePayload.categories.some((c: { category: string }) => c.category === 'devops')).toBe(true);

    const zhSearchRes = await tool.execute('call-zh', { query: '线上故障 复盘' });
    const zhPayload = JSON.parse((zhSearchRes.content[0] as { text: string }).text);
    expect(zhPayload.skills[0]?.name).toBe('incident-drill');

    const headingSearchRes = await tool.execute('call-heading', { query: '混沌工程' });
    const headingPayload = JSON.parse((headingSearchRes.content[0] as { text: string }).text);
    expect(headingPayload.skills[0]?.name).toBe('incident-drill');

    const catRes = await tool.execute('call-cat', { category: 'ops' });
    const catPayload = JSON.parse((catRes.content[0] as { text: string }).text);
    expect(catPayload.skills.map((s: { name: string }) => s.name)).toEqual(['incident-drill']);
  });
});

import { describe, expect, it } from 'vitest';

import { buildSkillMarkdownPreviewFromRaw } from '../skill-markdown-preview-from-raw.js';

describe('buildSkillMarkdownPreviewFromRaw', () => {
  it('splits SkillHub-style flat first line name/description', () => {
    const raw =
      'name: ontology description: Typed knowledge graph for agents.\n\n## Body\n\nHello.';
    const p = buildSkillMarkdownPreviewFromRaw(raw, { name: 'fallback', description: 'fb' });
    expect(p.name).toBe('ontology');
    expect(p.description).toBe('Typed knowledge graph for agents.');
    expect(p.bodyMarkdown).toBe('## Body\n\nHello.');
    expect(p.metadata.name).toBe('ontology');
    expect(p.metadata.description).toBe('Typed knowledge graph for agents.');
  });

  it('parses fenced YAML frontmatter', () => {
    const raw = `---
name: my-skill
description: From yaml
---
# Doc
`;
    const p = buildSkillMarkdownPreviewFromRaw(raw, { name: 'x', description: 'y' });
    expect(p.name).toBe('my-skill');
    expect(p.description).toBe('From yaml');
    expect(p.bodyMarkdown).toBe('# Doc');
  });
});

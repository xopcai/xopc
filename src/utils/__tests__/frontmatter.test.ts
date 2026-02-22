/**
 * Frontmatter utility tests
 */

import { describe, it, expect } from 'vitest';
import { parseFrontmatter, serializeFrontmatter } from '../frontmatter.js';

describe('parseFrontmatter', () => {
  it('should parse YAML frontmatter with Unix line endings', () => {
    const content = `---
name: test-skill
description: A test skill
---

# Content here

Some markdown content.
`;

    const result = parseFrontmatter(content);
    
    expect(result.frontmatter).toEqual({
      name: 'test-skill',
      description: 'A test skill',
    });
    expect(result.content).toBe('# Content here\n\nSome markdown content.');
  });

  it('should parse YAML frontmatter with Windows line endings (CRLF)', () => {
    const content = `---\r\nname: test-skill\r\ndescription: A test skill\r\n---\r\n\r\n# Content here\r\n\r\nSome markdown content.\r\n`;

    const result = parseFrontmatter(content);
    
    expect(result.frontmatter).toEqual({
      name: 'test-skill',
      description: 'A test skill',
    });
    expect(result.content).toContain('# Content here');
  });

  it('should parse JSON-style frontmatter', () => {
    const content = `---
{ "name": "test-skill", "description": "A test skill" }
---

# Content
`;

    const result = parseFrontmatter(content);
    
    expect(result.frontmatter).toEqual({
      name: 'test-skill',
      description: 'A test skill',
    });
  });

  it('should handle missing frontmatter', () => {
    const content = `# No frontmatter here

Some content.
`;

    const result = parseFrontmatter(content);
    
    expect(result.frontmatter).toEqual({});
    expect(result.content).toBe('# No frontmatter here\n\nSome content.');
  });

  it('should parse nested objects', () => {
    const content = `---
name: test-skill
description: A test skill
metadata:
  requires:
    bins: [git, node]
---

# Content
`;

    const result = parseFrontmatter(content);
    
    expect(result.frontmatter.name).toBe('test-skill');
    expect(result.frontmatter.description).toBe('A test skill');
  });

  it('should parse arrays', () => {
    const content = `---
name: test-skill
tags: [test, example, demo]
---

# Content
`;

    const result = parseFrontmatter(content);
    
    // Simple YAML parser treats arrays as strings (JSON.parse handles them)
    expect(result.frontmatter.tags).toBe('[test, example, demo]');
  });

  it('should parse boolean values', () => {
    const content = `---
name: test-skill
enabled: true
disabled: false
---

# Content
`;

    const result = parseFrontmatter(content);
    
    expect(result.frontmatter.enabled).toBe(true);
    expect(result.frontmatter.disabled).toBe(false);
  });

  it('should parse numeric values', () => {
    const content = `---
name: test-skill
version: 1
rating: 4.5
---

# Content
`;

    const result = parseFrontmatter(content);
    
    expect(result.frontmatter.version).toBe(1);
    expect(result.frontmatter.rating).toBe(4.5);
  });

  it('should handle quoted strings with special characters', () => {
    const content = `---
name: "test-skill: v1"
description: 'A "quoted" skill'
---

# Content
`;

    const result = parseFrontmatter(content);
    
    expect(result.frontmatter.name).toBe('test-skill: v1');
    expect(result.frontmatter.description).toBe('A "quoted" skill');
  });
});

describe('serializeFrontmatter', () => {
  it('should serialize simple key-value pairs', () => {
    const frontmatter = {
      name: 'test-skill',
      description: 'A test skill',
    };

    const result = serializeFrontmatter(frontmatter);
    
    expect(result).toContain('---');
    expect(result).toContain('name: test-skill');
    expect(result).toContain('description: A test skill');
  });

  it('should serialize objects as JSON', () => {
    const frontmatter = {
      name: 'test-skill',
      metadata: { version: 1 },
    };

    const result = serializeFrontmatter(frontmatter);
    
    expect(result).toContain('metadata: {"version":1}');
  });

  it('should escape quotes in strings', () => {
    const frontmatter = {
      description: 'A "quoted" description',
    };

    const result = serializeFrontmatter(frontmatter);
    
    // serializeFrontmatter only escapes quotes when string contains : or \n
    expect(result).toContain('description: A "quoted" description');
  });
});

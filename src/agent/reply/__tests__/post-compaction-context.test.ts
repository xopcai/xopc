import { describe, expect, it } from 'vitest';

import {
  extractSections,
  readPostCompactionContextFromAgentsMd,
} from '../post-compaction-context.js';

const SAMPLE_AGENTS = `# AGENTS

## Session Startup

Use runtime context first.

## Red Lines

Never exfiltrate data.

## Every Session

Read SOUL.md manually.
`;

describe('post-compaction-context', () => {
  it('extracts Session Startup and Red Lines only by default', () => {
    const found: string[] = [];
    const sections = extractSections(
      SAMPLE_AGENTS,
      ['Session Startup', 'Red Lines'],
      found,
    );
    expect(found).toEqual(['Session Startup', 'Red Lines']);
    expect(sections.join('\n')).toContain('Use runtime context first');
    expect(sections.join('\n')).not.toContain('Read SOUL.md manually');
  });

  it('does not fall back to Every Session when defaults missing', () => {
    const agentsWithoutStartup = `# AGENTS\n\n## Every Session\n\nRead files.\n`;
    const result = readPostCompactionContextFromAgentsMd(agentsWithoutStartup, {});
    expect(result).toBeNull();
  });

  it('uses the fixed default post-compaction sections', () => {
    const result = readPostCompactionContextFromAgentsMd(SAMPLE_AGENTS, {});
    expect(result).toContain('Session Startup');
    expect(result).toContain('Red Lines');
  });

  it('uses configured post-compaction sections instead of the defaults', () => {
    const result = readPostCompactionContextFromAgentsMd(SAMPLE_AGENTS, {
      sectionNames: ['Every Session'],
    });
    expect(result).toContain('Every Session');
    expect(result).toContain('Read SOUL.md manually');
    expect(result).not.toContain('Use runtime context first');
  });

  it('bounds injected context after resolving configured sections', () => {
    const result = readPostCompactionContextFromAgentsMd(SAMPLE_AGENTS, {
      sectionNames: ['Every Session'],
      maxContextChars: 20,
    });
    expect(result).toContain('...[truncated]...');
    expect(result).not.toContain('Read SOUL.md manually');
  });
});

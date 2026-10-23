import { describe, expect, it } from 'vitest';


import {
  bulletList,
  code,
  commandBullet,
  hint,
  joinBlocks,
  kvList,
  section,
} from '../format-output.js';

describe('format-output', () => {
  it('joinBlocks skips empty blocks and separates with blank lines', () => {
    expect(joinBlocks('a', '', undefined, 'b')).toBe('a\n\nb');
  });

  it('bulletList renders GFM dash bullets with optional labels', () => {
    expect(bulletList(['plain item'])).toBe('- plain item');
    expect(bulletList([{ label: 'audit_repo', detail: 'Repository audit' }])).toBe(
      '- **audit_repo** — Repository audit',
    );
  });

  it('kvList renders key/value bullets', () => {
    expect(kvList([{ key: 'Model', value: 'openai/gpt-4o' }])).toBe('- **Model**: openai/gpt-4o');
  });

  it('commandBullet formats slash command references', () => {
    expect(commandBullet('new', 'Start a new session', ['reset'])).toBe(
      '- `/new (reset)` — Start a new session',
    );
  });

  it('section, code, and hint helpers', () => {
    expect(section('Available skills')).toBe('**Available skills**');
    expect(code('/skill:review')).toBe('`/skill:review`');
    expect(hint('Copy the ref, then switch.')).toBe('_Copy the ref, then switch._');
  });
});

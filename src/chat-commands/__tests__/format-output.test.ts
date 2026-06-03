import { describe, expect, it } from 'vitest';

import { markdownToIR } from '../../markdown/ir.js';
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
    expect(section('Built-in workflows')).toBe('**Built-in workflows**');
    expect(code('/workflow view audit_repo')).toBe('`/workflow view audit_repo`');
    expect(hint('Copy the ref, then switch.')).toBe('_Copy the ref, then switch._');
  });

  it('sample workflow list parses as multi-line GFM (not one collapsed paragraph)', () => {
    const md = joinBlocks(
      section('Built-in workflows'),
      bulletList([
        { label: 'audit_repo', detail: 'Fan-out repository audit' },
        { label: 'multi_perspective_review', detail: 'Review from N perspectives' },
      ]),
      section('How to run'),
      bulletList([
        'Plain language: "run the audit_repo workflow"',
        `Inspect source: ${code('/workflow view audit_repo')}`,
      ]),
    );

    const ir = markdownToIR(md);
    expect(ir.text).toContain('audit_repo');
    expect(ir.text).toContain('multi_perspective_review');
    expect(ir.styles.some((s) => s.style === 'bold')).toBe(true);

    const bulletLines = md.split('\n').filter((line) => line.startsWith('- '));
    expect(bulletLines.length).toBeGreaterThanOrEqual(4);
    expect(md).toContain('\n\n');
  });
});

import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';

import { computeSkillTreeHashSync } from '../hub-hash.js';

describe('computeSkillTreeHashSync', () => {
  it('is stable for the same tree', () => {
    const a = join(tmpdir(), `h1-${Date.now()}`);
    const b = join(tmpdir(), `h2-${Date.now()}`);
    mkdirSync(a, { recursive: true });
    mkdirSync(b, { recursive: true });
    writeFileSync(join(a, 'SKILL.md'), 'x');
    writeFileSync(join(b, 'SKILL.md'), 'x');
    try {
      expect(computeSkillTreeHashSync(a)).toBe(computeSkillTreeHashSync(b));
    } finally {
      rmSync(a, { recursive: true, force: true });
      rmSync(b, { recursive: true, force: true });
    }
  });

  it('changes when file content changes', () => {
    const dir = join(tmpdir(), `h3-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'SKILL.md'), 'a');
    const h1 = computeSkillTreeHashSync(dir);
    writeFileSync(join(dir, 'SKILL.md'), 'b');
    const h2 = computeSkillTreeHashSync(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(h1).not.toBe(h2);
  });
});

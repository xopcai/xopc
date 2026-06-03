import { describe, expect, it } from 'vitest';

import { rewriteUnknownSlashAsWorkflow } from '../tui-workflow-slash.js';

const known = () => new Set(['audit_repo', 'multi_perspective_review', 'research']);

describe('rewriteUnknownSlashAsWorkflow', () => {
  it('rewrites a bare workflow name into a tool-triggering prompt', () => {
    const out = rewriteUnknownSlashAsWorkflow('audit_repo', '', known);
    expect(out).toMatch(/Run the audit_repo workflow/);
    expect(out).toMatch(/name="audit_repo"/);
  });

  it('appends free-form args as a hint when present', () => {
    const out = rewriteUnknownSlashAsWorkflow('research', 'How fast is bun?', known);
    expect(out).toMatch(/Run the research workflow/);
    expect(out).toMatch(/How fast is bun\?/);
  });

  it('returns null for unknown names', () => {
    expect(rewriteUnknownSlashAsWorkflow('nope', '', known)).toBeNull();
  });

  it('returns null for empty name', () => {
    expect(rewriteUnknownSlashAsWorkflow('', '', known)).toBeNull();
  });

  it('treats name case-sensitively (workflow names are snake_case)', () => {
    // Catalog names are lowercase snake_case; an upper-cased slash should NOT match.
    expect(rewriteUnknownSlashAsWorkflow('Audit_Repo', '', known)).toBeNull();
  });
});

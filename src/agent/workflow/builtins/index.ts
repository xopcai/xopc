/**
 * Bundled workflow templates. These are shipped with xopc and discoverable
 * via the catalog alongside user workflows in `~/.xopc/workflows/`. A user
 * workflow with the same `name` always wins — built-ins are starting points,
 * not authority.
 */

import { AUDIT_REPO_SCRIPT } from './audit-repo.js';
import { MULTI_PERSPECTIVE_REVIEW_SCRIPT } from './multi-perspective-review.js';
import { RESEARCH_SCRIPT } from './research.js';

export interface BuiltinWorkflow {
  name: string;
  script: string;
}

export const BUILTIN_WORKFLOWS: readonly BuiltinWorkflow[] = Object.freeze([
  { name: 'audit_repo', script: AUDIT_REPO_SCRIPT },
  { name: 'multi_perspective_review', script: MULTI_PERSPECTIVE_REVIEW_SCRIPT },
  { name: 'research', script: RESEARCH_SCRIPT },
]);

export { AUDIT_REPO_SCRIPT, MULTI_PERSPECTIVE_REVIEW_SCRIPT, RESEARCH_SCRIPT };

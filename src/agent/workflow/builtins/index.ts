/**
 * Bundled workflow templates. These are shipped with xopc and discoverable
 * via the catalog alongside user workflows in `~/.xopc/workflows/`. A user
 * workflow with the same `name` always wins — built-ins are starting points,
 * not authority.
 */

import { AUDIT_REPO_SCRIPT } from './audit-repo.js';
import { CLIENT_PROPOSAL_SCRIPT } from './client-proposal.js';
import { COMPETITOR_SCAN_SCRIPT } from './competitor-scan.js';
import { CONTENT_DRAFT_SCRIPT } from './content-draft.js';
import { CONTENT_REPURPOSE_SCRIPT } from './content-repurpose.js';
import { DEBUG_INCIDENT_SCRIPT } from './debug-incident.js';
import { DECISION_COMPARE_SCRIPT } from './decision-compare.js';
import { IMPLEMENTATION_PLAN_SCRIPT } from './implementation-plan.js';
import { INBOX_TRIAGE_SCRIPT } from './inbox-triage.js';
import { MEETING_PREP_SCRIPT } from './meeting-prep.js';
import { MULTI_PERSPECTIVE_REVIEW_SCRIPT } from './multi-perspective-review.js';
import { OFFER_DESIGN_SCRIPT } from './offer-design.js';
import { PR_REVIEW_SCRIPT } from './pr-review.js';
import { RELEASE_CHECK_SCRIPT } from './release-check.js';
import { RESEARCH_SCRIPT } from './research.js';
import { WEEKLY_REVIEW_SCRIPT } from './weekly-review.js';

export interface BuiltinWorkflow {
  name: string;
  script: string;
}

export const BUILTIN_WORKFLOWS: readonly BuiltinWorkflow[] = Object.freeze([
  { name: 'audit_repo', script: AUDIT_REPO_SCRIPT },
  { name: 'client_proposal', script: CLIENT_PROPOSAL_SCRIPT },
  { name: 'competitor_scan', script: COMPETITOR_SCAN_SCRIPT },
  { name: 'content_draft', script: CONTENT_DRAFT_SCRIPT },
  { name: 'content_repurpose', script: CONTENT_REPURPOSE_SCRIPT },
  { name: 'debug_incident', script: DEBUG_INCIDENT_SCRIPT },
  { name: 'decision_compare', script: DECISION_COMPARE_SCRIPT },
  { name: 'implementation_plan', script: IMPLEMENTATION_PLAN_SCRIPT },
  { name: 'inbox_triage', script: INBOX_TRIAGE_SCRIPT },
  { name: 'meeting_prep', script: MEETING_PREP_SCRIPT },
  { name: 'multi_perspective_review', script: MULTI_PERSPECTIVE_REVIEW_SCRIPT },
  { name: 'offer_design', script: OFFER_DESIGN_SCRIPT },
  { name: 'pr_review', script: PR_REVIEW_SCRIPT },
  { name: 'release_check', script: RELEASE_CHECK_SCRIPT },
  { name: 'research', script: RESEARCH_SCRIPT },
  { name: 'weekly_review', script: WEEKLY_REVIEW_SCRIPT },
]);

export {
  AUDIT_REPO_SCRIPT,
  CLIENT_PROPOSAL_SCRIPT,
  COMPETITOR_SCAN_SCRIPT,
  CONTENT_DRAFT_SCRIPT,
  CONTENT_REPURPOSE_SCRIPT,
  DEBUG_INCIDENT_SCRIPT,
  DECISION_COMPARE_SCRIPT,
  IMPLEMENTATION_PLAN_SCRIPT,
  INBOX_TRIAGE_SCRIPT,
  MEETING_PREP_SCRIPT,
  MULTI_PERSPECTIVE_REVIEW_SCRIPT,
  OFFER_DESIGN_SCRIPT,
  PR_REVIEW_SCRIPT,
  RELEASE_CHECK_SCRIPT,
  RESEARCH_SCRIPT,
  WEEKLY_REVIEW_SCRIPT,
};

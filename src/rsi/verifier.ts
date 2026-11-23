import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { inferMemorySensitivity } from '../agent/memory/sensitivity.js';
import { scanSkillDirectory } from '../agent/skills/scanner.js';
import {
  DEFAULT_MAX_SKILL_MD_CHARS,
  validateSkillMdContent,
  validateSkillNameSegment,
} from '../agent/skills/skill-manage-ops.js';
import { SkillTestFramework } from '../agent/skills/test-framework.js';
import type { RsiCapabilityCandidate, RsiGateDetail, RsiVerificationReport } from './types.js';

const PRIVILEGE_ESCALATION_PATTERNS: ReadonlyArray<{ re: RegExp; label: string }> = [
  { re: /ignore\s+(?:all\s+)?(?:previous|prior|system)\s+instructions/iu, label: 'Prompt override instruction' },
  { re: /bypass\s+(?:approval|confirmation|permission|policy|sandbox)/iu, label: 'Policy bypass directive' },
  { re: /auto_apply\s*[:=]\s*true|skip_confirmation\s*[:=]\s*true/iu, label: 'Confirmation bypass flag' },
  { re: /\brm\s+-rf\s+\/|\bcurl\b[^|\n]*\|\s*(?:sh|bash|zsh)\b/iu, label: 'Destructive or pipe-to-shell command' },
];

const PROTECTED_SIGNAL_SOURCES = new Set(['temporal:calendar', 'tasks', 'projects']);

function extractMarkdownHeadings(markdown: string): string[] {
  return markdown
    .split(/\r?\n/u)
    .filter(line => /^#{1,3}\s+\S+/u.test(line))
    .map(line => line.replace(/^#{1,3}\s+/u, '').trim().toLowerCase());
}

/**
 * Runs the 3-Gate Capability-Preserving Verification Pipeline on a staged RSI candidate:
 * - Gate A: Format, Sensitivity, Injection & Skill Security Scanner
 * - Gate B: SIM Completeness & Capability-Preserving Regression Guard
 * - Gate C: Scope Containment & Non-Escalation Invariant
 */
export async function verifyRsiCandidate(
  candidate: RsiCapabilityCandidate,
  stagingRootDir: string,
  now = Date.now(),
): Promise<RsiVerificationReport> {
  const gateAReasons: string[] = [];
  const gateBReasons: string[] = [];
  const gateCReasons: string[] = [];

  const serializedText = JSON.stringify({
    payload: candidate.stagedPayload,
    sim: candidate.simRationale,
  });

  // Gate A.1: Sensitivity & secret leak check.
  const sensitivity = inferMemorySensitivity(serializedText);
  if (sensitivity === 'secret' || sensitivity === 'regulated') {
    gateAReasons.push(`Blocked ${sensitivity} data from entering reusable capability artifact`);
  }

  // Gate A.2: Privilege escalation / prompt-injection pattern check.
  for (const rule of PRIVILEGE_ESCALATION_PATTERNS) {
    if (rule.re.test(serializedText)) {
      gateAReasons.push(`Detected unsafe directive: ${rule.label}`);
    }
  }

  // Gate A.3: Artifact-specific validation & SkillTestFramework / Scanner.
  if (candidate.stagedPayload.kind === 'skill') {
    const { skillName, skillMarkdown } = candidate.stagedPayload;
    const nameErr = validateSkillNameSegment(skillName, 'skillName');
    if (nameErr) gateAReasons.push(nameErr);

    const mdCheck = validateSkillMdContent(skillMarkdown, skillName, DEFAULT_MAX_SKILL_MD_CHARS);
    if (mdCheck.ok === false) {
      gateAReasons.push(mdCheck.error);
    } else if (!nameErr) {
      const stagedSkillDir = join(stagingRootDir, candidate.id, skillName);
      await mkdir(stagedSkillDir, { recursive: true });
      await writeFile(join(stagedSkillDir, 'SKILL.md'), skillMarkdown, 'utf8');

      const scan = await scanSkillDirectory(stagedSkillDir);
      if (scan.critical > 0) {
        gateAReasons.push(`Skill security scanner reported ${scan.critical} critical finding(s)`);
      }

      const testReport = await new SkillTestFramework({
        skipDeps: true,
        skipExamples: true,
      }).testSkill(stagedSkillDir);
      if (!testReport.passed) {
        const failedNames = testReport.results.filter(r => r.status === 'fail').map(r => r.name).join(', ');
        gateAReasons.push(`SkillTestFramework failed checks: ${failedNames || 'validation'}`);
      }
    }
  }

  // Gate B: SIM Completeness & Capability-Preserving Regression Guard.
  if (!candidate.sourceRefs.length) {
    gateBReasons.push('Candidate must reference at least one verifiable execution or feedback source');
  }
  if (!candidate.simRationale.applicabilityConditions.length || !candidate.simRationale.negativeConstraints.length) {
    gateBReasons.push('SIM rationale must include both applicability conditions and negative boundary constraints');
  }

  if (candidate.stagedPayload.kind === 'skill' && candidate.previousContentSnapshot) {
    const prev = candidate.previousContentSnapshot;
    const next = candidate.stagedPayload.skillMarkdown;
    if (prev.trim() === next.trim()) {
      gateBReasons.push('Candidate SKILL.md is identical to current version (no capability delta)');
    }
    if (next.length < prev.length * 0.6) {
      gateBReasons.push('Candidate SKILL.md truncates >40% of existing skill content, risking catastrophic forgetting');
    }
    const prevHeadings = extractMarkdownHeadings(prev);
    const nextHeadings = new Set(extractMarkdownHeadings(next));
    for (const heading of prevHeadings) {
      if (!nextHeadings.has(heading)) {
        gateBReasons.push(`Candidate dropped existing section heading "${heading}"`);
      }
    }
    for (const invariant of candidate.simRationale.preservedInvariants) {
      if (!next.toLowerCase().includes(invariant.toLowerCase())) {
        gateBReasons.push(`Candidate failed to preserve declared invariant: "${invariant}"`);
      }
    }
  }

  // Gate C: Scope Containment & Authority Invariant.
  if (
    candidate.scopeType === 'global'
    && candidate.triggerKind !== 'triage_mute'
    && candidate.sourceRefs.length < 2
  ) {
    gateCReasons.push('Global scope promotion requires multi-episode evidence (>= 2 independent source refs)');
  }
  if ((candidate.scopeType === 'project' || candidate.scopeType === 'workspace') && !candidate.scopeId?.trim()) {
    gateCReasons.push(`Scoped candidate (${candidate.scopeType}) requires an explicit scopeId`);
  }
  if (candidate.stagedPayload.kind === 'filter_rule') {
    const { sourcePattern, defaultRoute, matchPredicates } = candidate.stagedPayload;
    if (defaultRoute === 'drop' && sourcePattern === '*') {
      gateCReasons.push('Wildcard global drop rule is prohibited to prevent blinding all signals');
    }
    if (defaultRoute === 'drop' && PROTECTED_SIGNAL_SOURCES.has(sourcePattern)) {
      const hasNarrowFilter = Boolean(
        matchPredicates.equals && Object.keys(matchPredicates.equals).length > 0
        || matchPredicates.contains && Object.keys(matchPredicates.contains).length > 0
        || matchPredicates.in && Object.keys(matchPredicates.in).length > 0,
      );
      if (!hasNarrowFilter) {
        gateCReasons.push(`Cannot blanket-drop protected source "${sourcePattern}" without narrow field predicates`);
      }
    }
  }

  const gateA: RsiGateDetail = { passed: gateAReasons.length === 0, reasons: gateAReasons };
  const gateB: RsiGateDetail = { passed: gateBReasons.length === 0, reasons: gateBReasons };
  const gateC: RsiGateDetail = { passed: gateCReasons.length === 0, reasons: gateCReasons };

  return {
    overallPassed: gateA.passed && gateB.passed && gateC.passed,
    verifiedAt: now,
    gateA_security: gateA,
    gateB_capabilityPreservation: gateB,
    gateC_scopeAndAuthority: gateC,
  };
}

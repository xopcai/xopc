/**
 * Skill eligibility - check if a skill can be used in current environment
 */

import { accessSync, constants } from 'fs';
import { join, delimiter } from 'path';
import type { 
  Skill, 
  EligibilityContext, 
  EligibilityResult,
  ValidationDiagnostic 
} from './types.js';

/**
 * Check if a binary exists in PATH
 */
export function hasBinary(bin: string): boolean {
  const pathEnv = process.env.PATH ?? '';
  const parts = pathEnv.split(delimiter).filter(Boolean);
  
  for (const part of parts) {
    const candidate = join(part, bin);
    try {
      accessSync(candidate, constants.X_OK);
      return true;
    } catch {
      // Keep scanning
    }
  }
  return false;
}

/**
 * Check if environment variable is set
 */
export function hasEnv(env: string): boolean {
  return Boolean(process.env[env]);
}

/**
 * Default eligibility context
 */
export function createDefaultEligibilityContext(): EligibilityContext {
  return {
    hasBinary,
    hasEnv
  };
}

/**
 * Check if a skill is eligible to be used
 */
export function checkEligibility(
  skill: Skill,
  context: EligibilityContext = createDefaultEligibilityContext()
): EligibilityResult {
  const requires = skill.metadata?.requires;

  if (!requires) {
    return { eligible: true };
  }

  // Check required binaries
  if (requires.bins && requires.bins.length > 0) {
    for (const bin of requires.bins) {
      if (!context.hasBinary(bin)) {
        return {
          eligible: false,
          reason: `Missing required binary: ${bin}`
        };
      }
    }
  }

  // Check required environment variables
  if (requires.env && requires.env.length > 0) {
    for (const env of requires.env) {
      if (!context.hasEnv(env)) {
        return {
          eligible: false,
          reason: `Missing required environment variable: ${env}`
        };
      }
    }
  }

  return { eligible: true };
}

/**
 * Filter skills by eligibility
 */
export function filterEligibleSkills(
  skills: Skill[],
  context?: EligibilityContext
): { eligible: Skill[]; ineligible: Array<{ skill: Skill; reason: string }> } {
  const eligible: Skill[] = [];
  const ineligible: Array<{ skill: Skill; reason: string }> = [];

  const ctx = context || createDefaultEligibilityContext();

  for (const skill of skills) {
    const result = checkEligibility(skill, ctx);
    if (result.eligible) {
      eligible.push(skill);
    } else {
      ineligible.push({ skill, reason: result.reason || 'Unknown reason' });
    }
  }

  return { eligible, ineligible };
}

/**
 * Get eligibility diagnostics for all skills
 */
export function getEligibilityDiagnostics(
  skills: Skill[],
  context?: EligibilityContext
): ValidationDiagnostic[] {
  const diagnostics: ValidationDiagnostic[] = [];
  const ctx = context || createDefaultEligibilityContext();

  for (const skill of skills) {
    const result = checkEligibility(skill, ctx);
    if (!result.eligible) {
      diagnostics.push({
        type: 'warning',
        message: `Skill "${skill.name}" is not eligible: ${result.reason}`,
        path: skill.filePath
      });
    }
  }

  return diagnostics;
}

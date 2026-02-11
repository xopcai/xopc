/**
 * Skill validation - enforce Agent Skills specification
 */

import { basename, dirname } from 'path';
import type { 
  Skill, 
  ValidationResult, 
  ValidationDiagnostic
} from './types.js';

/** Valid name pattern: lowercase letters, numbers, hyphens */
const VALID_NAME_PATTERN = /^[a-z0-9-]+$/;

/**
 * Validate skill name per Agent Skills spec
 */
export function validateName(name: string, parentDirName: string): ValidationDiagnostic[] {
  const errors: ValidationDiagnostic[] = [];

  // Name must match directory name (for subdirectory skills)
  if (name !== parentDirName) {
    errors.push({
      type: 'warning',
      message: `Name "${name}" does not match parent directory "${parentDirName}"`,
      path: ''
    });
  }

  // Length check
  if (name.length > 64) {
    errors.push({
      type: 'error',
      message: `Name exceeds 64 characters (${name.length})`,
      path: ''
    });
  }

  // Character validation
  if (!VALID_NAME_PATTERN.test(name)) {
    errors.push({
      type: 'error',
      message: 'Name contains invalid characters (must be lowercase a-z, 0-9, hyphens only)',
      path: ''
    });
  }

  // Cannot start/end with hyphen
  if (name.startsWith('-') || name.endsWith('-')) {
    errors.push({
      type: 'error',
      message: 'Name must not start or end with a hyphen',
      path: ''
    });
  }

  // No consecutive hyphens
  if (name.includes('--')) {
    errors.push({
      type: 'error',
      message: 'Name must not contain consecutive hyphens',
      path: ''
    });
  }

  return errors;
}

/**
 * Validate skill description
 */
export function validateDescription(description: string | undefined): ValidationDiagnostic[] {
  const errors: ValidationDiagnostic[] = [];

  if (!description || description.trim() === '') {
    errors.push({
      type: 'error',
      message: 'Description is required',
      path: ''
    });
  } else if (description.length > 1024) {
    errors.push({
      type: 'warning',
      message: `Description exceeds 1024 characters (${description.length})`,
      path: ''
    });
  }

  return errors;
}

/**
 * Validate metadata structure
 */
export function validateMetadata(skill: Skill): ValidationDiagnostic[] {
  const errors: ValidationDiagnostic[] = [];
  
  // Use xopcbot-metadata for validation (deprecated field)
  const metadata = skill.frontmatter['xopcbot-metadata'];

  if (!metadata) {
    return errors; // Metadata is optional
  }

  // Validate category
  if (metadata.category) {
    const validCategories = ['utilities', 'devops', 'ai', 'data', 'communication', 'media', 'system'];
    if (!validCategories.includes(metadata.category)) {
      errors.push({
        type: 'warning',
        message: `Unknown category "${metadata.category}". Valid: ${validCategories.join(', ')}`,
        path: skill.filePath
      });
    }
  }

  // Validate invoke_as
  if (metadata.invoke_as) {
    const validModes = ['tool', 'command', 'both'];
    if (!validModes.includes(metadata.invoke_as)) {
      errors.push({
        type: 'warning',
        message: `Unknown invoke_as "${metadata.invoke_as}". Valid: ${validModes.join(', ')}`,
        path: skill.filePath
      });
    }
  }

  // Validate requires structure
  if (metadata.requires) {
    const requires = metadata.requires as { bins?: unknown; env?: unknown };
    if (requires.bins && !Array.isArray(requires.bins)) {
      errors.push({
        type: 'error',
        message: 'requires.bins must be an array of strings',
        path: skill.filePath
      });
    }
    if (requires.env && !Array.isArray(requires.env)) {
      errors.push({
        type: 'error',
        message: 'requires.env must be an array of strings',
        path: skill.filePath
      });
    }
  }

  return errors;
}

/**
 * Full skill validation
 */
export function validateSkill(skill: Skill): ValidationResult {
  const errors: ValidationDiagnostic[] = [];
  const warnings: ValidationDiagnostic[] = [];

  const parentDirName = basename(dirname(skill.filePath));

  // Validate name
  const nameErrors = validateName(skill.name, parentDirName);
  for (const err of nameErrors) {
    if (err.type === 'error') {
      errors.push({ ...err, path: skill.filePath });
    } else {
      warnings.push({ ...err, path: skill.filePath });
    }
  }

  // Validate description
  const descErrors = validateDescription(skill.description);
  for (const err of descErrors) {
    if (err.type === 'error') {
      errors.push({ ...err, path: skill.filePath });
    } else {
      warnings.push({ ...err, path: skill.filePath });
    }
  }

  // Validate metadata
  const metaErrors = validateMetadata(skill);
  warnings.push(...metaErrors);

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Validate all skills and return detailed results
 */
export function validateAllSkills(skills: Skill[]): {
  valid: Skill[];
  invalid: Array<{ skill: Skill; result: ValidationResult }>;
  allDiagnostics: ValidationDiagnostic[];
} {
  const valid: Skill[] = [];
  const invalid: Array<{ skill: Skill; result: ValidationResult }> = [];
  const allDiagnostics: ValidationDiagnostic[] = [];

  for (const skill of skills) {
    const result = validateSkill(skill);
    allDiagnostics.push(...result.errors, ...result.warnings);

    if (result.valid) {
      valid.push(skill);
    } else {
      invalid.push({ skill, result });
    }
  }

  return { valid, invalid, allDiagnostics };
}

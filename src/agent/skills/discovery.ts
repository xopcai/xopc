/**
 * Skill discovery - find and load skills from directories
 * Implements Claude Code style discovery: root .md + subdirectory SKILL.md
 */

import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'fs';
import { dirname, join, relative, resolve, sep } from 'path';
import type { 
  DiscoveryOptions, 
  DiscoveryResult, 
  Skill, 
  SkillFrontmatter, 
  SkillSource,
  ValidationDiagnostic 
} from './types.js';
import { parseFrontmatter } from '../../utils/frontmatter.js';

/**
 * Check if a file/directory should be ignored based on simple rules
 * (node_modules, hidden files)
 */
function shouldIgnore(name: string, isDir: boolean): boolean {
  if (name.startsWith('.')) return true;
  if (name === 'node_modules') return true;
  return false;
}

/**
 * Load skill from a markdown file
 */
function loadSkillFromFile(
  filePath: string, 
  source: SkillSource,
  expectedName?: string
): { skill: Skill | null; diagnostics: ValidationDiagnostic[] } {
  const diagnostics: ValidationDiagnostic[] = [];

  try {
    const rawContent = readFileSync(filePath, 'utf-8');
    const { frontmatter, content } = parseFrontmatter(rawContent);
    const skillDir = dirname(filePath);
    const parentDirName = skillDir.split(sep).pop() || '';

    // Determine skill name
    const name = (frontmatter.name as string | undefined) || parentDirName || expectedName;
    
    if (!name) {
      diagnostics.push({
        type: 'error',
        message: 'Could not determine skill name (no name in frontmatter, and no directory name)',
        path: filePath
      });
      return { skill: null, diagnostics };
    }

    // Validate description exists
    const description = frontmatter.description as string | undefined;
    if (!description || description.trim() === '') {
      diagnostics.push({
        type: 'error',
        message: 'Missing required field: description',
        path: filePath
      });
      return { skill: null, diagnostics };
    }

    // Extract xopcbot metadata
    const metadata = (frontmatter.metadata as { xopcbot?: import('./types.js').XopcbotMetadata } | undefined)?.xopcbot;

    const skill: Skill = {
      name,
      description: description.trim(),
      filePath,
      baseDir: skillDir,
      source,
      disableModelInvocation: frontmatter['disable-model-invocation'] === true,
      metadata,
      content: content.trim(),
      frontmatter: frontmatter as SkillFrontmatter
    };

    return { skill, diagnostics };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to parse skill file';
    diagnostics.push({ type: 'error', message, path: filePath });
    return { skill: null, diagnostics };
  }
}

/**
 * Discover skills from a directory
 * 
 * Discovery rules (Claude Code style):
 * - Root level .md files = skills
 * - Subdirectories containing SKILL.md = skills
 * - Respects .gitignore patterns if respectIgnoreFiles is true
 */
export function discoverSkills(options: DiscoveryOptions): DiscoveryResult {
  const { dir, source, respectIgnoreFiles = true } = options;
  const skills: Skill[] = [];
  const diagnostics: ValidationDiagnostic[] = [];
  const seenRealPaths = new Set<string>();

  if (!existsSync(dir)) {
    return { skills, diagnostics };
  }

  function scanDirectory(currentDir: string, isRoot: boolean) {
    try {
      const entries = readdirSync(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        if (shouldIgnore(entry.name, entry.isDirectory())) {
          continue;
        }

        const fullPath = join(currentDir, entry.name);

        // Handle symlinks - check if they point to valid locations
        let isDirectory = entry.isDirectory();
        let isFile = entry.isFile();
        
        if (entry.isSymbolicLink()) {
          try {
            const stats = statSync(fullPath);
            isDirectory = stats.isDirectory();
            isFile = stats.isFile();
          } catch {
            continue; // Broken symlink
          }
        }

        if (isDirectory) {
          // Check for SKILL.md in subdirectory
          const skillMdPath = join(fullPath, 'SKILL.md');
          if (existsSync(skillMdPath)) {
            const result = loadSkillFromFile(skillMdPath, source);
            
            if (result.skill) {
              // Check for duplicate (symlink)
              try {
                const realPath = realpathSync(result.skill.filePath);
                if (seenRealPaths.has(realPath)) {
                  continue; // Skip duplicate
                }
                seenRealPaths.add(realPath);
              } catch {
                // If realpath fails, use filePath
              }
              
              skills.push(result.skill);
            }
            
            diagnostics.push(...result.diagnostics);
          }
          
          // Continue scanning deeper
          scanDirectory(fullPath, false);
        } else if (isFile && isRoot && entry.name.endsWith('.md')) {
          // Root-level .md file = skill
          const result = loadSkillFromFile(fullPath, source);
          
          if (result.skill) {
            // Derive name from filename for root-level skills
            if (!result.skill.frontmatter.name) {
              result.skill.name = entry.name.replace(/\.md$/, '');
            }
            
            // Check for duplicate
            try {
              const realPath = realpathSync(result.skill.filePath);
              if (seenRealPaths.has(realPath)) {
                continue;
              }
              seenRealPaths.add(realPath);
            } catch {}
            
            skills.push(result.skill);
          }
          
          diagnostics.push(...result.diagnostics);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to read directory';
      diagnostics.push({ type: 'warning', message, path: currentDir });
    }
  }

  scanDirectory(dir, true);
  return { skills, diagnostics };
}

/**
 * Discover skills from multiple directories with priority
 * Later directories override earlier ones (by name)
 */
export function discoverSkillsFromMultiple(
  configs: Array<{ dir: string; source: SkillSource }>
): DiscoveryResult {
  const allSkills = new Map<string, Skill>();
  const allDiagnostics: ValidationDiagnostic[] = [];

  for (const config of configs) {
    const result = discoverSkills(config);
    
    for (const skill of result.skills) {
      const existing = allSkills.get(skill.name);
      if (existing) {
        allDiagnostics.push({
          type: 'warning',
          message: `Skill "${skill.name}" collision: ${existing.filePath} overrides ${skill.filePath}`,
          path: skill.filePath
        });
      }
      allSkills.set(skill.name, skill);
    }
    
    allDiagnostics.push(...result.diagnostics);
  }

  return {
    skills: Array.from(allSkills.values()),
    diagnostics: allDiagnostics
  };
}

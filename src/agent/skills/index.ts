import { existsSync, readdirSync, readFileSync } from 'fs';
import { basename, dirname, join, relative, sep } from 'path';
import { parseFrontmatter } from '../../markdown/frontmatter.js';
import { resolveStateDir } from '../../config/paths.js';
import { createLogger } from '../../utils/logger.js';
import { createSkillConfigManager, isSkillEnabled } from './config.js';
import { formatSkillsForPrompt } from './format-skills-prompt.js';
import { parseRequiredEnvVarNames } from './required-env-vars.js';
import { parseSkillMetadata } from './parse-skill-metadata.js';
import { parseSkillToolConditions } from './skill-tool-gating.js';
import { resolveWorkspaceSkillsDir } from './workspace-skills-dir.js';
import type { Skill, SkillDiagnostic, LoadSkillsResult, SkillConfig, SkillsConfig } from './types.js';

const log = createLogger('SkillLoader');

const IGNORE_FILES = ['.gitignore', '.ignore', '.fdignore'];

function toPosixPath(p: string): string {
  return p.split(sep).join('/');
}

function prefixIgnorePattern(line: string, prefix: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('#') && !trimmed.startsWith('\\#')) return null;

  let pattern = line;
  let negated = false;

  if (pattern.startsWith('!')) {
    negated = true;
    pattern = pattern.slice(1);
  } else if (pattern.startsWith('\\!')) {
    pattern = pattern.slice(1);
  }

  if (pattern.startsWith('/')) {
    pattern = pattern.slice(1);
  }

  const prefixed = prefix ? `${prefix}${pattern}` : pattern;
  return negated ? `!${prefixed}` : prefixed;
}

function loadIgnoreRules(dir: string, rootDir: string): Set<string> {
  const ignoredPaths = new Set<string>();
  const relativeDir = relative(rootDir, dir);
  const prefix = relativeDir ? `${toPosixPath(relativeDir)}/` : '';

  for (const filename of IGNORE_FILES) {
    const ignorePath = join(dir, filename);
    if (!existsSync(ignorePath)) continue;

    try {
      const content = readFileSync(ignorePath, 'utf-8');
      for (const line of content.split(/\r?\n/)) {
        const pattern = prefixIgnorePattern(line, prefix);
        if (pattern) {
          const fullPattern = pattern.startsWith('!')
            ? `!${prefix}${pattern.slice(1)}`
            : `${prefix}${pattern}`;
          ignoredPaths.add(fullPattern);
        }
      }
    } catch {}
  }

  return ignoredPaths;
}

function shouldIgnore(path: string, ignoredPaths: Set<string>): boolean {
  for (const pattern of ignoredPaths) {
    if (pattern.startsWith('!')) {
      const positive = pattern.slice(1);
      if (path === positive || path.startsWith(`${positive}/`)) {
        return false;
      }
    } else {
      if (path === pattern || path.startsWith(`${pattern}/`)) {
        return true;
      }
    }
  }
  return false;
}

function discoverSkills(
  dir: string,
  source: 'builtin' | 'workspace' | 'global',
): { skills: Skill[]; diagnostics: SkillDiagnostic[] } {
  const skills: Skill[] = [];
  const diagnostics: SkillDiagnostic[] = [];
  if (!existsSync(dir)) return { skills, diagnostics };

  function scan(currentDir: string, currentIgnoredPaths: Set<string>) {
    try {
      const entries = readdirSync(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

        const fullPath = join(currentDir, entry.name);
        const relPath = toPosixPath(relative(dir, fullPath));

        if (shouldIgnore(relPath, currentIgnoredPaths)) continue;

        if (entry.isDirectory()) {
          const skillMdPath = join(fullPath, 'SKILL.md');
          const skillRelPath = `${relPath}/`;

          const subIgnoredPaths = new Set(currentIgnoredPaths);
          const subIgnoreFile = join(fullPath, '.gitignore');
          if (existsSync(subIgnoreFile)) {
            const subRules = loadIgnoreRules(fullPath, dir);
            for (const rule of subRules) {
              subIgnoredPaths.add(`${skillRelPath}${rule}`);
            }
          }

          if (existsSync(skillMdPath) && !shouldIgnore(skillRelPath, currentIgnoredPaths)) {
            const { skill, diagnostic } = loadSkillFromFile(skillMdPath, source, dir);
            if (diagnostic) diagnostics.push(diagnostic);
            if (skill) skills.push(skill);
          }

          scan(fullPath, subIgnoredPaths);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      diagnostics.push({
        type: 'error',
        message: `Failed to scan skills directory: ${message}`,
        path: currentDir,
      });
    }
  }

  scan(dir, loadIgnoreRules(dir, dir));
  return { skills, diagnostics };
}

function deriveDescriptionFromMarkdown(content: string): string | undefined {
  let fallbackHeading = '';

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const heading = line.match(/^#{1,6}\s+(.+)$/);
    if (heading) {
      fallbackHeading ||= heading[1]?.trim() ?? '';
      continue;
    }

    return line
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/[*_`~]/g, '')
      .trim() || undefined;
  }

  return fallbackHeading || undefined;
}

function loadSkillFromFile(
  filePath: string,
  source: 'builtin' | 'workspace' | 'global',
  rootDir?: string,
): { skill: Skill | null; diagnostic?: SkillDiagnostic } {
  try {
    const rawContent = readFileSync(filePath, 'utf-8');
    const { frontmatter, content } = parseFrontmatter(rawContent);
    const skillDir = dirname(filePath);
    const parentDirName = basename(skillDir);

    const name = (frontmatter.name as string | undefined) || parentDirName;
    const description =
      (frontmatter.description as string | undefined)?.trim() || deriveDescriptionFromMarkdown(content);
    if (!description?.trim()) {
      return {
        skill: null,
        diagnostic: {
          type: 'error',
          skillName: name,
          message: `Skill "${name}" is missing a description`,
          path: filePath,
        },
      };
    }

    // Derive category from directory path: .xopc/skills/creative/algorithmic-art → 'creative'
    // Only assign a category when the skill is nested at least two levels below rootDir.
    let category: string | undefined;
    if (rootDir) {
      const relDir = toPosixPath(relative(rootDir, skillDir));
      const segments = relDir.split('/');
      if (segments.length > 1) {
        category = segments[0];
      }
    }

    const metadata = parseSkillMetadata(frontmatter);
    metadata.name ||= name;
    metadata.description ||= description.trim();
    const toolConditions = parseSkillToolConditions(frontmatter);
    const requiredEnvVarNames = parseRequiredEnvVarNames(frontmatter);

    return {
      skill: {
        name,
        description: description.trim(),
        category,
        filePath,
        baseDir: skillDir,
        source,
        disableModelInvocation: frontmatter['disable-model-invocation'] === true,
        metadata,
        toolConditions,
        requiredEnvVarNames: requiredEnvVarNames.length > 0 ? requiredEnvVarNames : undefined,
        content,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      skill: null,
      diagnostic: {
        type: 'error',
        message: `Failed to load skill file: ${message}`,
        path: filePath,
      },
    };
  }
}

export function loadSkills(options: {
  workspaceDir?: string;
  globalDir?: string;
  builtinDir?: string;
  extraDirs?: string[];
}): LoadSkillsResult {
  const { workspaceDir, builtinDir, extraDirs = [] } = options;

  const skillMap = new Map<string, Skill>();
  const diagnostics: SkillDiagnostic[] = [];

  if (builtinDir) {
    const discovered = discoverSkills(builtinDir, 'builtin');
    diagnostics.push(...discovered.diagnostics);
    for (const skill of discovered.skills) {
      if (!skillMap.has(skill.name)) {
        skillMap.set(skill.name, skill);
      }
    }
  }

  const globalDirs = [
    options.globalDir,
    join(resolveStateDir(), 'skills'),
  ].filter((d): d is string => !!d && existsSync(d));

  for (const dir of globalDirs) {
    const discovered = discoverSkills(dir, 'global');
    diagnostics.push(...discovered.diagnostics);
    for (const skill of discovered.skills) {
      // Global must win over bundled when names match (Workspace > Global > Bundled).
      skillMap.set(skill.name, skill);
    }
  }

  if (workspaceDir) {
    const discovered = discoverSkills(resolveWorkspaceSkillsDir(workspaceDir), 'workspace');
    diagnostics.push(...discovered.diagnostics);
    const workspaceSkills = discovered.skills;
    for (const skill of workspaceSkills) {
      skillMap.set(skill.name, skill);
    }
  }

  // Scan extra directories
  for (const extraDir of extraDirs) {
    if (existsSync(extraDir)) {
      const discovered = discoverSkills(extraDir, 'global');
      diagnostics.push(...discovered.diagnostics);
      for (const skill of discovered.skills) {
        if (!skillMap.has(skill.name)) {
          skillMap.set(skill.name, skill);
        }
      }
    }
  }

  const skillsConfig = createSkillConfigManager(resolveStateDir()).load();
  const merged = Array.from(skillMap.values());

  return {
    skills: merged,
    prompt: formatSkillsForPrompt(merged, skillsConfig),
    diagnostics,
  };
}

export interface SkillLoader {
  init: (workspace: string, builtin: string | null) => LoadSkillsResult;
  load: () => LoadSkillsResult;
  reload: () => LoadSkillsResult;
  /** Recompute `<available_skills>` from disk-loaded skills and current ~/.xopc/skills.json (no filesystem rescan). */
  refreshPromptFromConfig: () => void;
  getSkills: () => Skill[];
  getPrompt: () => string;
  getDiagnostics: () => SkillDiagnostic[];
  getLastLoadTime: () => number;
  getSkillByName: (name: string) => Skill | undefined;
  getEnabledSkills: (config?: Record<string, SkillConfig>) => Skill[];
}

export function createSkillLoader(): SkillLoader {
  let cachedSkills: Skill[] = [];
  let cachedPrompt: string = '';
  let cachedDiagnostics: SkillDiagnostic[] = [];
  let lastLoadTime = 0;
  let workspaceDir: string | undefined;
  let builtinDir: string | undefined;
  let extraDirs: string[] = [];

  function updateCache(result: LoadSkillsResult): LoadSkillsResult {
    cachedSkills = result.skills;
    cachedPrompt = result.prompt;
    cachedDiagnostics = result.diagnostics;
    lastLoadTime = Date.now();
    return result;
  }

  return {
    init: (workspace: string, builtin: string | null) => {
      workspaceDir = workspace;
      builtinDir = builtin || undefined;
      return updateCache(loadSkills({ workspaceDir, builtinDir, extraDirs }));
    },
    
    load: () => {
      return updateCache(loadSkills({ workspaceDir, builtinDir, extraDirs }));
    },
    
    reload: () => {
      log.info('Reloading skills');
      return updateCache(loadSkills({ workspaceDir, builtinDir, extraDirs }));
    },

    refreshPromptFromConfig: () => {
      const skillsConfig = createSkillConfigManager(resolveStateDir()).load();
      cachedPrompt = formatSkillsForPrompt(cachedSkills, skillsConfig);
      lastLoadTime = Date.now();
    },

    getSkills: () => cachedSkills,
    getPrompt: () => cachedPrompt,
    getDiagnostics: () => cachedDiagnostics,
    getLastLoadTime: () => lastLoadTime,
    
    getSkillByName: (name: string) => {
      return cachedSkills.find(s => s.name === name);
    },
    
    getEnabledSkills: (entries?: Record<string, SkillConfig>) => {
      const skillsConfig: SkillsConfig =
        entries !== undefined ? { entries } : createSkillConfigManager(resolveStateDir()).load();
      return cachedSkills.filter(
        (skill) => !skill.disableModelInvocation && isSkillEnabled(skill, skillsConfig),
      );
    },
  };
}

// `SkillManager` + sibling types removed from this barrel — `skill-manager.ts`
// imports `createSkillLoader` from THIS file, so re-exporting it back here
// formed a circular cycle. External callers should import directly from
// `./skill-manager.js`.

// Re-export types for convenience
export type { 
  Skill, 
  SkillMetadata, 
  SkillConfig,
  SkillInstallSpec,
  SkillInstallResult,
  SkillInstallRequest,
  LoadSkillsResult,
  // Note: SkillDiagnostic is re-exported from skill-manager.ts above
  SkillSnapshot,
} from './types.js';

// Re-export installer
export { 
  installSkill, 
  findInstallSpec,
  hasBinary,
  getDefaultInstallerPreferences,
  type InstallerPreferences,
  type InstallContext,
} from './installer.js';

// Re-export scanner
export {
  scanSkillDirectory,
  formatScanSummary,
  collectSkillInstallWarnings,
  type ScanSummary,
  type SecurityFinding,
  type Severity,
} from './scanner.js';

// Re-export config manager
export {
  resolveSkillConfig,
  applySkillEnvOverrides,
  getSkillEnvironment,
  createSkillConfigManager,
  isSkillEnabled,
  validateSkillConfig,
  type SkillConfigFile,
} from './config.js';

// `watcher.ts` re-exports removed — it imports `SkillLoader` from THIS file, so
// re-exporting back here formed a circular cycle. External callers should
// import directly from `./watcher.js`.

// Re-export test framework
export {
  SkillTestFramework,
  SkillTestRunner,
  formatTestResults,
  formatTestResultsJson,
  formatTestResultsTap,
  type TestResult,
  type TestStatus,
  type SkillTestReport,
  type TestOptions,
  type TestRunnerOptions,
} from './test-framework.js';

import { existsSync, readdirSync, readFileSync } from 'fs';
import { basename, dirname, join, relative, sep } from 'path';
import { parseFrontmatter } from '../../utils/frontmatter.js';
import { DEFAULT_BASE_DIR } from '../../config/paths.js';
import { createLogger } from '../../utils/logger.js';
import type { 
  Skill, 
  SkillMetadata, 
  SkillDiagnostic, 
  LoadSkillsResult,
  SkillConfig,
  SkillInstallSpec,
  SkillRequires,
} from './types.js';

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

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatSkillXml(skill: Skill): string {
  const emoji = skill.metadata.emoji || skill.metadata.openclaw?.emoji || '';
  const emojiStr = emoji ? `${emoji} ` : '';
  
  return [
    '  <skill>',
    `    <name>${escapeXml(skill.name)}</name>`,
    `    <description>${emojiStr}${escapeXml(skill.description)}</description>`,
    `    <location>${escapeXml(skill.filePath)}</location>`,
    '  </skill>',
  ].join('\n');
}

function formatSkillsForPrompt(skills: Skill[]): string {
  const visibleSkills = skills.filter(s => !s.disableModelInvocation);
  if (visibleSkills.length === 0) return '';

  const lines = [
    '\n\n<available_skills>',
    'Skills are folders of instructions, scripts, and resources.',
    'Use the read tool to load a skill\'s file when the task matches its description.',
    '',
  ];

  for (const skill of visibleSkills) {
    lines.push(formatSkillXml(skill));
  }

  lines.push('</available_skills>');
  return lines.join('\n');
}

function discoverSkills(dir: string, source: 'builtin' | 'workspace' | 'global'): Skill[] {
  const skills: Skill[] = [];
  if (!existsSync(dir)) return skills;

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
            const skill = loadSkillFromFile(skillMdPath, source);
            if (skill) skills.push(skill);
          }

          scan(fullPath, subIgnoredPaths);
        }
      }
    } catch {}
  }

  scan(dir, loadIgnoreRules(dir, dir));
  return skills;
}

function parseSkillMetadata(frontmatter: Record<string, unknown>): SkillMetadata {
  // Support both direct metadata and openclaw-compatible nested metadata
  const metadata: SkillMetadata = {
    name: frontmatter.name as string || '',
    description: frontmatter.description as string || '',
    emoji: frontmatter.emoji as string || undefined,
    homepage: frontmatter.homepage as string || undefined,
    os: frontmatter.os as Array<'darwin' | 'linux' | 'win32'> || undefined,
    requires: frontmatter.requires as SkillMetadata['requires'] || undefined,
    install: frontmatter.install as SkillInstallSpec[] || undefined,
  };

  // Support openclaw-compatible nested metadata
  const openclawMeta = frontmatter.metadata as Record<string, unknown> | undefined;
  if (openclawMeta?.openclaw) {
    const oc = openclawMeta.openclaw as Record<string, unknown>;
    metadata.openclaw = {
      emoji: oc.emoji as string || undefined,
      requires: oc.requires as SkillRequires || undefined,
      install: oc.install as SkillInstallSpec[] || undefined,
      os: oc.os as Array<'darwin' | 'linux' | 'win32'> || undefined,
    };
    
    // Merge openclaw metadata if direct metadata is missing
    if (!metadata.emoji && metadata.openclaw.emoji) {
      metadata.emoji = metadata.openclaw.emoji;
    }
    if (!metadata.requires && metadata.openclaw.requires) {
      metadata.requires = metadata.openclaw.requires;
    }
    if (!metadata.install && metadata.openclaw.install) {
      metadata.install = metadata.openclaw.install;
    }
    if (!metadata.os && metadata.openclaw.os) {
      metadata.os = metadata.openclaw.os;
    }
  }

  return metadata;
}

function loadSkillFromFile(filePath: string, source: 'builtin' | 'workspace' | 'global'): Skill | null {
  try {
    const rawContent = readFileSync(filePath, 'utf-8');
    const { frontmatter, content } = parseFrontmatter(rawContent);
    const skillDir = dirname(filePath);
    const parentDirName = basename(skillDir);

    const name = (frontmatter.name as string | undefined) || parentDirName;
    const description = frontmatter.description as string | undefined;
    if (!description?.trim()) return null;

    const metadata = parseSkillMetadata(frontmatter);

    return {
      name,
      description: description.trim(),
      filePath,
      baseDir: skillDir,
      source,
      disableModelInvocation: frontmatter['disable-model-invocation'] === true,
      metadata,
      content,
    };
  } catch {
    return null;
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
    for (const skill of discoverSkills(builtinDir, 'builtin')) {
      const existing = skillMap.get(skill.name);
      if (existing) {
        diagnostics.push({
          type: 'collision',
          skillName: skill.name,
          message: `Skill "${skill.name}" collision: ${existing.source} overrides ${skill.source}`,
          path: skill.filePath,
        });
      } else {
        skillMap.set(skill.name, skill);
      }
    }
  }

  const globalDirs = [
    options.globalDir,
    join(DEFAULT_BASE_DIR, 'skills'),
    join(process.env.HOME || '', '.agents', 'skills'),
  ].filter((d): d is string => !!d && existsSync(d));

  for (const dir of globalDirs) {
    for (const skill of discoverSkills(dir, 'global')) {
      const existing = skillMap.get(skill.name);
      if (existing) {
        diagnostics.push({
          type: 'collision',
          skillName: skill.name,
          message: `Skill "${skill.name}" collision: ${existing.source} overrides ${skill.source}`,
          path: skill.filePath,
        });
      } else {
        skillMap.set(skill.name, skill);
      }
    }
  }

  if (workspaceDir) {
    const workspaceSkills = discoverSkills(join(workspaceDir, 'skills'), 'workspace');
    for (const skill of workspaceSkills) {
      const existing = skillMap.get(skill.name);
      if (existing) {
        diagnostics.push({
          type: 'collision',
          skillName: skill.name,
          message: `Skill "${skill.name}" collision: ${skill.source} overrides ${existing.source}`,
          path: skill.filePath,
        });
      }
      skillMap.set(skill.name, skill);
    }
  }

  // Scan extra directories
  for (const extraDir of extraDirs) {
    if (existsSync(extraDir)) {
      for (const skill of discoverSkills(extraDir, 'global')) {
        const existing = skillMap.get(skill.name);
        if (existing) {
          diagnostics.push({
            type: 'collision',
            skillName: skill.name,
            message: `Skill "${skill.name}" collision: ${existing.source} overrides ${skill.source}`,
            path: skill.filePath,
          });
        } else {
          skillMap.set(skill.name, skill);
        }
      }
    }
  }

  return {
    skills: Array.from(skillMap.values()),
    prompt: formatSkillsForPrompt(Array.from(skillMap.values())),
    diagnostics,
  };
}

export interface SkillLoader {
  init: (workspace: string, builtin: string | null) => LoadSkillsResult;
  load: () => LoadSkillsResult;
  reload: () => LoadSkillsResult;
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
    
    getSkills: () => cachedSkills,
    getPrompt: () => cachedPrompt,
    getDiagnostics: () => cachedDiagnostics,
    getLastLoadTime: () => lastLoadTime,
    
    getSkillByName: (name: string) => {
      return cachedSkills.find(s => s.name === name);
    },
    
    getEnabledSkills: (config?: Record<string, SkillConfig>) => {
      if (!config) {
        return cachedSkills.filter(s => !s.disableModelInvocation);
      }
      
      return cachedSkills.filter(skill => {
        const skillConfig = config[skill.name];
        if (skillConfig?.enabled === false) {
          return false;
        }
        return !skill.disableModelInvocation;
      });
    },
  };
}

// Re-export types for convenience
export type { 
  Skill, 
  SkillMetadata, 
  SkillConfig,
  SkillInstallSpec,
  SkillInstallResult,
  SkillInstallRequest,
  LoadSkillsResult,
  SkillDiagnostic,
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

// Re-export watcher
export {
  createSkillWatcher,
  createWatcherFromLoader,
  type SkillWatcher,
  type SkillWatcherOptions,
} from './watcher.js';

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

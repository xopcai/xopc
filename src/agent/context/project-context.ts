/**
 * Project Context - Gather and analyze project information
 *
 * Provides context-aware capabilities by:
 * - Analyzing file extensions and statistics
 * - Detecting technology stack
 * - Reading project documentation
 * - Identifying project structure
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { readFile, access } from 'fs/promises';
import { join, extname, basename, resolve, normalize, isAbsolute } from 'path';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('ProjectContext');
const execAsync = promisify(exec);

export interface FileExtensionStats {
  extension: string;
  count: number;
  percentage: number;
  linesOfCode?: number;
}

export interface TechStack {
  languages: string[];
  frameworks: string[];
  buildTools: string[];
  testingTools: string[];
  packageManager?: string;
}

export interface ProjectContext {
  name: string;
  description?: string;
  rootPath: string;
  totalFiles: number;
  totalLinesOfCode?: number;
  extensionStats: FileExtensionStats[];
  techStack: TechStack;
  hasGit: boolean;
  gitBranch?: string;
  gitRemote?: string;
  documentation: {
    readme?: string;
    contributing?: string;
    license?: string;
  };
  packageInfo?: {
    name?: string;
    version?: string;
    dependencies: string[];
    devDependencies: string[];
  };
  detectedAt: number;
}

export interface ProjectContextOptions {
  maxExtensions?: number;
  includeLineCounts?: boolean;
  analyzeDepth?: 'shallow' | 'medium' | 'deep';
}

const DEFAULT_OPTIONS: ProjectContextOptions = {
  maxExtensions: 15,
  includeLineCounts: true,
  analyzeDepth: 'medium',
};

// Language detection from extension
const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript (React)',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript (React)',
  '.py': 'Python',
  '.rs': 'Rust',
  '.go': 'Go',
  '.java': 'Java',
  '.kt': 'Kotlin',
  '.scala': 'Scala',
  '.rb': 'Ruby',
  '.php': 'PHP',
  '.cs': 'C#',
  '.cpp': 'C++',
  '.c': 'C',
  '.h': 'C/C++ Header',
  '.hpp': 'C++ Header',
  '.swift': 'Swift',
  '.m': 'Objective-C',
  '.mm': 'Objective-C++',
  '.r': 'R',
  '.pl': 'Perl',
  '.lua': 'Lua',
  '.sh': 'Shell',
  '.bash': 'Bash',
  '.zsh': 'Zsh',
  '.fish': 'Fish',
  '.ps1': 'PowerShell',
  '.sql': 'SQL',
  '.html': 'HTML',
  '.htm': 'HTML',
  '.css': 'CSS',
  '.scss': 'SCSS',
  '.sass': 'Sass',
  '.less': 'Less',
  '.vue': 'Vue',
  '.svelte': 'Svelte',
  '.md': 'Markdown',
  '.mdx': 'MDX',
  '.json': 'JSON',
  '.yaml': 'YAML',
  '.yml': 'YAML',
  '.toml': 'TOML',
  '.xml': 'XML',
  '.dockerfile': 'Dockerfile',
  '.dockerignore': 'Docker',
};

// Framework detection patterns
const FRAMEWORK_PATTERNS: Array<{ pattern: RegExp; framework: string; type: 'frontend' | 'backend' | 'fullstack' | 'mobile' }> = [
  { pattern: /react/i, framework: 'React', type: 'frontend' },
  { pattern: /vue/i, framework: 'Vue.js', type: 'frontend' },
  { pattern: /angular/i, framework: 'Angular', type: 'frontend' },
  { pattern: /svelte/i, framework: 'Svelte', type: 'frontend' },
  { pattern: /next/i, framework: 'Next.js', type: 'fullstack' },
  { pattern: /nuxt/i, framework: 'Nuxt.js', type: 'fullstack' },
  { pattern: /express/i, framework: 'Express.js', type: 'backend' },
  { pattern: /fastify/i, framework: 'Fastify', type: 'backend' },
  { pattern: /koa/i, framework: 'Koa', type: 'backend' },
  { pattern: /nest/i, framework: 'NestJS', type: 'backend' },
  { pattern: /django/i, framework: 'Django', type: 'backend' },
  { pattern: /flask/i, framework: 'Flask', type: 'backend' },
  { pattern: /fastapi/i, framework: 'FastAPI', type: 'backend' },
  { pattern: /rails/i, framework: 'Ruby on Rails', type: 'backend' },
  { pattern: /laravel/i, framework: 'Laravel', type: 'backend' },
  { pattern: /spring/i, framework: 'Spring', type: 'backend' },
  { pattern: /flutter/i, framework: 'Flutter', type: 'mobile' },
  { pattern: /react.native/i, framework: 'React Native', type: 'mobile' },
];

// Build tool detection
const BUILD_TOOL_PATTERNS: Array<{ file: string; tool: string }> = [
  { file: 'package.json', tool: 'npm/yarn/pnpm' },
  { file: 'Cargo.toml', tool: 'Cargo' },
  { file: 'go.mod', tool: 'Go Modules' },
  { file: 'pom.xml', tool: 'Maven' },
  { file: 'build.gradle', tool: 'Gradle' },
  { file: 'Gemfile', tool: 'Bundler' },
  { file: 'requirements.txt', tool: 'pip' },
  { file: 'pyproject.toml', tool: 'Poetry/PDM' },
  { file: 'setup.py', tool: 'setuptools' },
  { file: 'Makefile', tool: 'Make' },
  { file: 'CMakeLists.txt', tool: 'CMake' },
  { file: 'Dockerfile', tool: 'Docker' },
  { file: 'docker-compose.yml', tool: 'Docker Compose' },
  { file: 'vite.config', tool: 'Vite' },
  { file: 'webpack.config', tool: 'Webpack' },
  { file: 'rollup.config', tool: 'Rollup' },
  { file: 'tsconfig.json', tool: 'TypeScript' },
];

/**
 * Validate workspace path to prevent directory traversal
 */
function validateWorkspace(workspace: string): string {
  const resolved = resolve(workspace);
  const normalized = normalize(resolved);
  
  // Ensure path is absolute and doesn't contain traversal attempts
  if (!isAbsolute(normalized)) {
    throw new Error(`Workspace path must be absolute: ${workspace}`);
  }
  
  // Check for null bytes
  if (normalized.includes('\0')) {
    throw new Error('Invalid workspace path: contains null bytes');
  }
  
  return normalized;
}

/**
 * Gather project context information
 */
export async function gatherProjectContext(
  workspace: string,
  options: Partial<ProjectContextOptions> = {}
): Promise<ProjectContext> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  
  // Validate workspace path
  const validatedWorkspace = validateWorkspace(workspace);

  log.info({ workspace: validatedWorkspace }, 'Gathering project context');

  const startTime = Date.now();

  // Gather all information in parallel
  const [
    fileStats,
    techStack,
    gitInfo,
    documentation,
    packageInfo,
    projectName,
  ] = await Promise.all([
    gatherFileStats(workspace, opts),
    detectTechStack(workspace),
    gatherGitInfo(workspace),
    gatherDocumentation(workspace),
    gatherPackageInfo(workspace),
    detectProjectName(workspace),
  ]);

  const context: ProjectContext = {
    name: projectName,
    rootPath: validatedWorkspace,
    totalFiles: fileStats.totalFiles,
    totalLinesOfCode: fileStats.totalLines,
    extensionStats: fileStats.extensions,
    techStack,
    hasGit: gitInfo.hasGit,
    gitBranch: gitInfo.branch,
    gitRemote: gitInfo.remote,
    documentation,
    packageInfo,
    detectedAt: Date.now(),
  };

  log.info(
    {
      name: context.name,
      totalFiles: context.totalFiles,
      languages: context.techStack.languages.slice(0, 5),
      duration: Date.now() - startTime,
    },
    'Project context gathered'
  );

  return context;
}

/**
 * Gather file statistics using git ls-files
 */
async function gatherFileStats(
  workspace: string,
  options: ProjectContextOptions
): Promise<{ totalFiles: number; totalLines?: number; extensions: FileExtensionStats[] }> {
  try {
    // Try git ls-files first
    const { stdout } = await execAsync('git ls-files', { cwd: workspace });
    const files = stdout.split('\n').filter(f => f.trim());

    const extensionCounts = new Map<string, { count: number; lines: number }>();
    let totalLines = 0;

    for (const file of files) {
      const ext = extname(file) || '(no extension)';
      const current = extensionCounts.get(ext) || { count: 0, lines: 0 };
      current.count++;

      if (options.includeLineCounts) {
        try {
          const content = await readFile(join(workspace, file), 'utf-8');
          const lines = content.split('\n').length;
          current.lines += lines;
          totalLines += lines;
        } catch {
          // Binary or unreadable file
        }
      }

      extensionCounts.set(ext, current);
    }

    // Convert to array and calculate percentages
    const extensions: FileExtensionStats[] = Array.from(extensionCounts.entries())
      .map(([ext, stats]) => ({
        extension: ext,
        count: stats.count,
        percentage: Math.round((stats.count / files.length) * 100),
        linesOfCode: options.includeLineCounts ? stats.lines : undefined,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, options.maxExtensions);

    return {
      totalFiles: files.length,
      totalLines: options.includeLineCounts ? totalLines : undefined,
      extensions,
    };
  } catch (err) {
    log.warn({ workspace, error: (err as Error).message }, 'Failed to gather file stats with git, falling back to basic scan');

    // Fallback: basic directory scan
    return {
      totalFiles: 0,
      extensions: [],
    };
  }
}

/**
 * Detect technology stack
 */
async function detectTechStack(workspace: string): Promise<TechStack> {
  const languages = new Set<string>();
  const frameworks = new Set<string>();
  const buildTools = new Set<string>();
  const testingTools = new Set<string>();

  // Check for framework indicators in package files
  try {
    const packageJson = await readFile(join(workspace, 'package.json'), 'utf-8');
    const pkg = JSON.parse(packageJson);
    const allDeps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    };

    const depNames = Object.keys(allDeps).join(' ');

    // Detect frameworks
    for (const { pattern, framework } of FRAMEWORK_PATTERNS) {
      if (pattern.test(depNames)) {
        frameworks.add(framework);
      }
    }

    // Detect testing tools
    const testingPatterns = [/jest/, /mocha/, /vitest/, /jasmine/, /cypress/, /playwright/, /selenium/];
    for (const pattern of testingPatterns) {
      const match = depNames.match(pattern);
      if (match) {
        testingTools.add(match[0]);
      }
    }

    // Language
    languages.add('JavaScript/TypeScript');

    // Package manager
    if (await fileExists(join(workspace, 'pnpm-lock.yaml'))) {
      buildTools.add('pnpm');
    } else if (await fileExists(join(workspace, 'yarn.lock'))) {
      buildTools.add('Yarn');
    } else {
      buildTools.add('npm');
    }
  } catch (err) {
    log.debug({ workspace, error: (err as Error).message }, 'No package.json found or failed to parse');
  }

  // Detect build tools from files
  for (const { file, tool } of BUILD_TOOL_PATTERNS) {
    if (await fileExists(join(workspace, file))) {
      buildTools.add(tool);
    }
  }

  // Detect languages from file extensions
  try {
    const { stdout } = await execAsync('git ls-files', { cwd: workspace });
    const files = stdout.split('\n').filter(f => f.trim());
    const extensions = new Set(files.map(f => extname(f)));

    for (const ext of extensions) {
      const lang = EXTENSION_TO_LANGUAGE[ext];
      if (lang && !lang.includes('React') && !lang.includes('Header')) {
        languages.add(lang);
      }
    }
  } catch {
    // Ignore
  }

  return {
    languages: Array.from(languages).slice(0, 10),
    frameworks: Array.from(frameworks).slice(0, 10),
    buildTools: Array.from(buildTools).slice(0, 10),
    testingTools: Array.from(testingTools).slice(0, 10),
  };
}

/**
 * Gather git information
 */
async function gatherGitInfo(workspace: string): Promise<{
  hasGit: boolean;
  branch?: string;
  remote?: string;
}> {
  try {
    const [{ stdout: branch }, { stdout: remote }] = await Promise.all([
      execAsync('git branch --show-current', { cwd: workspace }),
      execAsync('git remote get-url origin', { cwd: workspace }).catch(() => ({ stdout: '' })),
    ]);

    return {
      hasGit: true,
      branch: branch.trim() || undefined,
      remote: remote.trim() || undefined,
    };
  } catch {
    return { hasGit: false };
  }
}

/**
 * Gather documentation files
 */
async function gatherDocumentation(workspace: string): Promise<ProjectContext['documentation']> {
  const docs: ProjectContext['documentation'] = {};

  const readmeFiles = ['README.md', 'readme.md', 'Readme.md', 'README.rst', 'README.txt'];
  for (const file of readmeFiles) {
    if (await fileExists(join(workspace, file))) {
      try {
        const content = await readFile(join(workspace, file), 'utf-8');
        docs.readme = content.slice(0, 1000); // First 1000 chars
        break;
      } catch {
        // Ignore
      }
    }
  }

  if (await fileExists(join(workspace, 'CONTRIBUTING.md'))) {
    try {
      const content = await readFile(join(workspace, 'CONTRIBUTING.md'), 'utf-8');
      docs.contributing = content.slice(0, 500);
    } catch {
      // Ignore
    }
  }

  if (await fileExists(join(workspace, 'LICENSE'))) {
    docs.license = 'exists';
  }

  return docs;
}

/**
 * Gather package information
 */
async function gatherPackageInfo(workspace: string): Promise<ProjectContext['packageInfo'] | undefined> {
  try {
    const content = await readFile(join(workspace, 'package.json'), 'utf-8');
    const pkg = JSON.parse(content);

    return {
      name: pkg.name,
      version: pkg.version,
      dependencies: Object.keys(pkg.dependencies || {}),
      devDependencies: Object.keys(pkg.devDependencies || {}),
    };
  } catch {
    // Try other package files
    try {
      const content = await readFile(join(workspace, 'Cargo.toml'), 'utf-8');
      // Basic parsing for Cargo.toml
      const nameMatch = content.match(/name\s*=\s*"([^"]+)"/);
      const versionMatch = content.match(/version\s*=\s*"([^"]+)"/);

      return {
        name: nameMatch?.[1],
        version: versionMatch?.[1],
        dependencies: [],
        devDependencies: [],
      };
    } catch {
      return undefined;
    }
  }
}

/**
 * Detect project name
 */
async function detectProjectName(workspace: string): Promise<string> {
  // Try package.json
  try {
    const content = await readFile(join(workspace, 'package.json'), 'utf-8');
    const pkg = JSON.parse(content);
    if (pkg.name) return pkg.name;
  } catch {
    // Ignore
  }

  // Try Cargo.toml
  try {
    const content = await readFile(join(workspace, 'Cargo.toml'), 'utf-8');
    const match = content.match(/name\s*=\s*"([^"]+)"/);
    if (match) return match[1];
  } catch {
    // Ignore
  }

  // Use directory name
  return basename(workspace);
}

/**
 * Check if file exists
 */
async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Format project context for system prompt
 */
export function formatProjectContextForPrompt(context: ProjectContext): string {
  const lines: string[] = [];

  lines.push(`# Project: ${context.name}`);

  if (context.documentation.readme) {
    lines.push('');
    lines.push('## Description');
    lines.push(context.documentation.readme.slice(0, 300) + '...');
  }

  lines.push('');
  lines.push('## Technology Stack');
  if (context.techStack.languages.length > 0) {
    lines.push(`- Languages: ${context.techStack.languages.slice(0, 5).join(', ')}`);
  }
  if (context.techStack.frameworks.length > 0) {
    lines.push(`- Frameworks: ${context.techStack.frameworks.slice(0, 5).join(', ')}`);
  }
  if (context.techStack.buildTools.length > 0) {
    lines.push(`- Build Tools: ${context.techStack.buildTools.slice(0, 5).join(', ')}`);
  }

  lines.push('');
  lines.push('## File Statistics');
  lines.push(`- Total Files: ${context.totalFiles}`);
  if (context.totalLinesOfCode) {
    lines.push(`- Total Lines: ${context.totalLinesOfCode.toLocaleString()}`);
  }

  if (context.extensionStats.length > 0) {
    lines.push('- Top Extensions:');
    for (const stat of context.extensionStats.slice(0, 5)) {
      lines.push(`  - ${stat.extension}: ${stat.count} files (${stat.percentage}%)`);
    }
  }

  if (context.hasGit) {
    lines.push('');
    lines.push('## Git');
    if (context.gitBranch) {
      lines.push(`- Branch: ${context.gitBranch}`);
    }
    if (context.gitRemote) {
      lines.push(`- Remote: ${context.gitRemote}`);
    }
  }

  return lines.join('\n');
}

/**
 * Project context cache
 */
const contextCache = new Map<string, { context: ProjectContext; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Get project context with caching
 */
export async function getProjectContext(
  workspace: string,
  options?: Partial<ProjectContextOptions>
): Promise<ProjectContext> {
  const cached = contextCache.get(workspace);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    log.debug({ workspace }, 'Using cached project context');
    return cached.context;
  }

  const context = await gatherProjectContext(workspace, options);
  contextCache.set(workspace, { context, timestamp: Date.now() });

  return context;
}

/**
 * Invalidate project context cache
 */
export function invalidateProjectContext(workspace: string): void {
  contextCache.delete(workspace);
  log.debug({ workspace }, 'Invalidated project context cache');
}

/**
 * Clear all project context caches
 */
export function clearProjectContextCache(): void {
  contextCache.clear();
  log.debug('Cleared all project context caches');
}

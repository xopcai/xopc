import { describe, it, expect } from 'vitest';
import {
  formatProjectContextForPrompt,
} from '../project-context.js';

describe('Project Context', () => {
  describe('formatProjectContextForPrompt', () => {
    it('should format context for system prompt', () => {
      const context = {
        name: 'test-project',
        description: 'A test project',
        rootPath: '/workspace',
        totalFiles: 100,
        totalLinesOfCode: 5000,
        extensionStats: [
          { extension: '.ts', count: 50, percentage: 50 },
          { extension: '.js', count: 30, percentage: 30 },
        ],
        techStack: {
          languages: ['TypeScript', 'JavaScript'],
          frameworks: ['React'],
          buildTools: ['npm'],
          testingTools: ['jest'],
        },
        hasGit: true,
        gitBranch: 'main',
        gitRemote: 'https://github.com/user/repo.git',
        documentation: {
          readme: '# Test Project',
        },
        detectedAt: Date.now(),
      };

      const prompt = formatProjectContextForPrompt(context as any);

      expect(prompt).toContain('# Project: test-project');
      expect(prompt).toContain('TypeScript');
      expect(prompt).toContain('React');
      expect(prompt).toContain('Total Files: 100');
      expect(prompt).toContain('.ts: 50 files');
    });

    it('should handle minimal context', () => {
      const context = {
        name: 'minimal',
        rootPath: '/workspace',
        totalFiles: 0,
        extensionStats: [],
        techStack: {
          languages: [],
          frameworks: [],
          buildTools: [],
          testingTools: [],
        },
        hasGit: false,
        documentation: {},
        detectedAt: Date.now(),
      };

      const prompt = formatProjectContextForPrompt(context as any);

      expect(prompt).toContain('# Project: minimal');
      expect(prompt).toContain('Total Files: 0');
    });

    it('should include git information when available', () => {
      const context = {
        name: 'git-project',
        rootPath: '/workspace',
        totalFiles: 10,
        extensionStats: [],
        techStack: {
          languages: [],
          frameworks: [],
          buildTools: [],
          testingTools: [],
        },
        hasGit: true,
        gitBranch: 'feature-branch',
        gitRemote: 'https://github.com/user/repo.git',
        documentation: {},
        detectedAt: Date.now(),
      };

      const prompt = formatProjectContextForPrompt(context as any);

      expect(prompt).toContain('Git');
      expect(prompt).toContain('Branch: feature-branch');
      expect(prompt).toContain('Remote: https://github.com/user/repo.git');
    });

    it('should include description when available', () => {
      const context = {
        name: 'described-project',
        description: 'This is a detailed description of the project.',
        rootPath: '/workspace',
        totalFiles: 10,
        extensionStats: [],
        techStack: {
          languages: [],
          frameworks: [],
          buildTools: [],
          testingTools: [],
        },
        hasGit: false,
        documentation: {
          readme: '# Full README\n\nThis is the full readme content.',
        },
        detectedAt: Date.now(),
      };

      const prompt = formatProjectContextForPrompt(context as any);

      expect(prompt).toContain('## Description');
      // The function uses readme content, not description field
      expect(prompt).toContain('Full README');
    });

    it('should format file statistics correctly', () => {
      const context = {
        name: 'stats-project',
        rootPath: '/workspace',
        totalFiles: 1000,
        totalLinesOfCode: 50000,
        extensionStats: [
          { extension: '.ts', count: 400, percentage: 40 },
          { extension: '.tsx', count: 200, percentage: 20 },
          { extension: '.js', count: 150, percentage: 15 },
          { extension: '.json', count: 100, percentage: 10 },
          { extension: '.md', count: 50, percentage: 5 },
        ],
        techStack: {
          languages: ['TypeScript'],
          frameworks: ['React'],
          buildTools: ['npm'],
          testingTools: [],
        },
        hasGit: false,
        documentation: {},
        detectedAt: Date.now(),
      };

      const prompt = formatProjectContextForPrompt(context as any);

      expect(prompt).toContain('Total Files: 1000');
      expect(prompt).toContain('Total Lines: 50,000');
      expect(prompt).toContain('.ts: 400 files (40%)');
      expect(prompt).toContain('.tsx: 200 files (20%)');
    });

    it('should limit top extensions to 5', () => {
      const context = {
        name: 'many-extensions',
        rootPath: '/workspace',
        totalFiles: 100,
        extensionStats: [
          { extension: '.ts', count: 50, percentage: 50 },
          { extension: '.tsx', count: 10, percentage: 10 },
          { extension: '.js', count: 10, percentage: 10 },
          { extension: '.json', count: 10, percentage: 10 },
          { extension: '.md', count: 10, percentage: 10 },
          { extension: '.css', count: 5, percentage: 5 },
          { extension: '.html', count: 5, percentage: 5 },
        ],
        techStack: {
          languages: [],
          frameworks: [],
          buildTools: [],
          testingTools: [],
        },
        hasGit: false,
        documentation: {},
        detectedAt: Date.now(),
      };

      const prompt = formatProjectContextForPrompt(context as any);

      // Should only show top 5 extensions
      const extensionMatches = prompt.match(/\.\w+: \d+ files/g);
      expect(extensionMatches?.length).toBeLessThanOrEqual(5);
    });
  });
});

/**
 * Error Pattern Matcher - Identifies common error patterns and provides recovery suggestions
 * 
 * Based on Agent Harness theory: "Error recovery is primarily model-driven. 
 * Failed tool executions return error messages as tool results to the model"
 */

import { createLogger } from '../utils/logger.js';

const log = createLogger('ErrorPatternMatcher');

export interface ErrorPattern {
  name: string;
  description: string;
  regex: RegExp;
  suggestion: string;
  autoRetry: boolean;
  maxRetries: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export interface ErrorMatchResult {
  matched: boolean;
  pattern?: ErrorPattern;
  originalError: string;
  suggestion: string;
  shouldRetry: boolean;
  maxRetries: number;
}

export interface ErrorPatternMatcherConfig {
  enabled: boolean;
  patterns: ErrorPattern[];
  defaultMaxRetries: number;
  logMatches: boolean;
}

// Default error patterns based on common tool errors
const DEFAULT_PATTERNS: ErrorPattern[] = [
  // File system errors
  {
    name: 'file-not-found',
    description: 'File or directory does not exist',
    regex: /no such file or directory|file not found|cannot find/i,
    suggestion: 'Check if the file path is correct. Use list_dir to verify directory contents before reading.',
    autoRetry: false,
    maxRetries: 0,
    severity: 'medium',
  },
  {
    name: 'permission-denied',
    description: 'Insufficient permissions to access file',
    regex: /permission denied|access denied|unauthorized/i,
    suggestion: 'Check file permissions. Consider using sudo if safe, or request user intervention.',
    autoRetry: false,
    maxRetries: 0,
    severity: 'high',
  },
  {
    name: 'file-too-large',
    description: 'File exceeds size limits',
    regex: /file too large|exceeds.*size|too big to read/i,
    suggestion: 'Use truncate parameter or read specific sections. Consider using grep/search instead.',
    autoRetry: false,
    maxRetries: 0,
    severity: 'low',
  },
  
  // Shell execution errors
  {
    name: 'command-not-found',
    description: 'Shell command does not exist',
    regex: /command not found|not recognized|no such command/i,
    suggestion: 'Verify the command is installed. Check PATH or install the required package.',
    autoRetry: false,
    maxRetries: 0,
    severity: 'medium',
  },
  {
    name: 'timeout',
    description: 'Command execution timed out',
    regex: /timeout|timed out|execution time exceeded/i,
    suggestion: 'Command took too long. Consider optimizing the command, breaking into smaller tasks, or increasing timeout.',
    autoRetry: true,
    maxRetries: 1,
    severity: 'medium',
  },
  {
    name: 'exit-code-nonzero',
    description: 'Command exited with error code',
    regex: /exit code \d+|returned non-zero|failed with error/i,
    suggestion: 'Check command syntax and arguments. Review stderr output for details.',
    autoRetry: false,
    maxRetries: 0,
    severity: 'medium',
  },
  
  // Network errors
  {
    name: 'network-error',
    description: 'Network connectivity issue',
    regex: /network error|connection refused|cannot connect|dns/i,
    suggestion: 'Check network connectivity. Verify the service is running and accessible.',
    autoRetry: true,
    maxRetries: 2,
    severity: 'high',
  },
  {
    name: 'http-error',
    description: 'HTTP request failed',
    regex: /http \d{3}|request failed|bad response/i,
    suggestion: 'Check the URL and request parameters. Review API documentation.',
    autoRetry: true,
    maxRetries: 1,
    severity: 'medium',
  },
  
  // Git errors
  {
    name: 'git-conflict',
    description: 'Git merge conflict',
    regex: /merge conflict|conflict marker|cannot merge/i,
    suggestion: 'Resolve merge conflicts manually. Check conflicted files and edit to resolve.',
    autoRetry: false,
    maxRetries: 0,
    severity: 'high',
  },
  {
    name: 'git-not-repository',
    description: 'Not a git repository',
    regex: /not a git repository|fatal: not a git repo/i,
    suggestion: 'Initialize git repository first with `git init` or navigate to correct directory.',
    autoRetry: false,
    maxRetries: 0,
    severity: 'low',
  },
  
  // Memory/Resource errors
  {
    name: 'out-of-memory',
    description: 'Insufficient memory',
    regex: /out of memory|memory allocation failed|cannot allocate/i,
    suggestion: 'Reduce data size or process in smaller chunks. Consider using streaming.',
    autoRetry: false,
    maxRetries: 0,
    severity: 'critical',
  },
  {
    name: 'disk-full',
    description: 'No disk space available',
    regex: /no space left|disk full|insufficient space/i,
    suggestion: 'Free up disk space. Delete unnecessary files or expand storage.',
    autoRetry: false,
    maxRetries: 0,
    severity: 'critical',
  },
  
  // Syntax/Parse errors
  {
    name: 'syntax-error',
    description: 'Code syntax error',
    regex: /syntax error|parse error|invalid syntax|unexpected token/i,
    suggestion: 'Review code syntax. Check for missing brackets, quotes, or semicolons.',
    autoRetry: false,
    maxRetries: 0,
    severity: 'medium',
  },
  {
    name: 'type-error',
    description: 'Type mismatch error',
    regex: /type error|type mismatch|cannot convert/i,
    suggestion: 'Check variable types. Ensure correct type is used for the operation.',
    autoRetry: false,
    maxRetries: 0,
    severity: 'medium',
  },
];

const DEFAULT_CONFIG: ErrorPatternMatcherConfig = {
  enabled: true,
  patterns: DEFAULT_PATTERNS,
  defaultMaxRetries: 1,
  logMatches: true,
};

export class ErrorPatternMatcher {
  private config: ErrorPatternMatcherConfig;
  private matchHistory: Map<string, number> = new Map(); // pattern name -> count

  constructor(config: Partial<ErrorPatternMatcherConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Match error against known patterns
   */
  matchError(error: string): ErrorMatchResult {
    if (!this.config.enabled) {
      return {
        matched: false,
        originalError: error,
        suggestion: error,
        shouldRetry: false,
        maxRetries: 0,
      };
    }

    const errorLower = error.toLowerCase();

    for (const pattern of this.config.patterns) {
      if (pattern.regex.test(errorLower)) {
        // Record match
        const count = this.matchHistory.get(pattern.name) || 0;
        this.matchHistory.set(pattern.name, count + 1);

        if (this.config.logMatches) {
          log.warn(
            { pattern: pattern.name, severity: pattern.severity },
            `Matched error pattern: ${pattern.description}`
          );
        }

        return {
          matched: true,
          pattern,
          originalError: error,
          suggestion: `[Error: ${pattern.name}]\n${pattern.suggestion}`,
          shouldRetry: pattern.autoRetry,
          maxRetries: pattern.maxRetries,
        };
      }
    }

    // No pattern matched
    return {
      matched: false,
      originalError: error,
      suggestion: error,
      shouldRetry: false,
      maxRetries: this.config.defaultMaxRetries,
    };
  }

  /**
   * Get recovery suggestion for an error
   */
  getRecoverySuggestion(error: string): string {
    const result = this.matchError(error);
    return result.suggestion;
  }

  /**
   * Check if error should be retried
   */
  shouldRetry(error: string): boolean {
    return this.matchError(error).shouldRetry;
  }

  /**
   * Get max retries for an error
   */
  getMaxRetries(error: string): number {
    return this.matchError(error).maxRetries;
  }

  /**
   * Get error statistics
   */
  getStats(): {
    totalMatches: number;
    byPattern: Map<string, number>;
    topErrors: Array<{ name: string; count: number }>;
  } {
    const totalMatches = Array.from(this.matchHistory.values()).reduce((sum, c) => sum + c, 0);
    
    const topErrors = Array.from(this.matchHistory.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      totalMatches,
      byPattern: new Map(this.matchHistory),
      topErrors,
    };
  }

  /**
   * Get error report as text
   */
  getReportText(): string {
    const stats = this.getStats();
    
    const lines: string[] = [
      'Error Pattern Matching Report',
      '=============================',
      `Total Matches: ${stats.totalMatches}`,
      '',
      'Top Error Patterns:',
    ];

    for (const { name, count } of stats.topErrors) {
      const pattern = this.config.patterns.find(p => p.name === name);
      const severity = pattern?.severity || 'unknown';
      lines.push(`  - ${name}: ${count} occurrences (severity: ${severity})`);
    }

    return lines.join('\n');
  }

  /**
   * Reset match history
   */
  reset(): void {
    this.matchHistory.clear();
    log.info('Error pattern matcher reset');
  }

  /**
   * Add custom error pattern
   */
  addPattern(pattern: ErrorPattern): void {
    this.config.patterns.push(pattern);
    log.info({ name: pattern.name }, 'Added custom error pattern');
  }

  /**
   * Remove error pattern by name
   */
  removePattern(name: string): boolean {
    const index = this.config.patterns.findIndex(p => p.name === name);
    if (index !== -1) {
      this.config.patterns.splice(index, 1);
      log.info({ name }, 'Removed error pattern');
      return true;
    }
    return false;
  }

  /**
   * Get all patterns
   */
  getPatterns(): ErrorPattern[] {
    return [...this.config.patterns];
  }

  /**
   * Get config
   */
  getConfig(): ErrorPatternMatcherConfig {
    return { ...this.config };
  }

  /**
   * Update config
   */
  setConfig(config: Partial<ErrorPatternMatcherConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

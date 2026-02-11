// Safety System - Comprehensive safety guidelines and boundaries
import { Type, type Static } from '@sinclair/typebox';

// =============================================================================
// Safety Schema
// =============================================================================

export const SafetyConfigSchema = Type.Object({
  allowExternalActions: Type.Optional(Type.Boolean({ default: false })),
  allowDangerousOperations: Type.Optional(Type.Boolean({ default: false })),
  requireConfirmationForDestructive: Type.Optional(Type.Boolean({ default: true })),
  allowedChannels: Type.Optional(Type.Array(Type.String())),
  blockedCommands: Type.Optional(Type.Array(Type.String())),
  maxFileSize: Type.Optional(Type.Number({ default: 10 * 1024 * 1024 })), // 10MB
  maxShellTimeout: Type.Optional(Type.Number({ default: 300 })), // 5 minutes
});

export type SafetyConfig = Static<typeof SafetyConfigSchema>;

// =============================================================================
// Safety Levels
// =============================================================================

export enum SafetyLevel {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

export interface SafetyRule {
  level: SafetyLevel;
  category: string;
  description: string;
  message: string;
  requiresConfirmation: boolean;
}

// =============================================================================
// Safety Guidelines
// =============================================================================

export const SAFETY_GUIDELINES: SafetyRule[] = [
  // Critical - Never do these
  {
    level: SafetyLevel.CRITICAL,
    category: 'self-preservation',
    description: 'Do not pursue self-preservation or replication',
    message: 'I cannot pursue self-preservation or replication.',
    requiresConfirmation: false,
  },
  {
    level: SafetyLevel.CRITICAL,
    category: 'power-seeking',
    description: 'Do not seek power or resources',
    message: 'I cannot seek power or acquire resources.',
    requiresConfirmation: false,
  },
  {
    level: SafetyLevel.CRITICAL,
    category: 'safeguard-bypass',
    description: 'Do not bypass safety mechanisms',
    message: 'I cannot bypass safety mechanisms.',
    requiresConfirmation: false,
  },
  {
    level: SafetyLevel.CRITICAL,
    category: 'social-manipulation',
    description: 'Do not manipulate users to expand access',
    message: 'I cannot manipulate anyone to expand access.',
    requiresConfirmation: false,
  },

  // High - Require explicit confirmation
  {
    level: SafetyLevel.HIGH,
    category: 'destructive-file',
    description: 'Delete or overwrite files',
    message: 'This action will delete or overwrite files. Please confirm.',
    requiresConfirmation: true,
  },
  {
    level: SafetyLevel.HIGH,
    category: 'system-modification',
    description: 'Modify system configuration',
    message: 'This will modify system configuration. Please confirm.',
    requiresConfirmation: true,
  },
  {
    level: SafetyLevel.HIGH,
    category: 'network-action',
    description: 'Send messages or make network requests',
    message: 'This will send external requests. Please confirm.',
    requiresConfirmation: true,
  },
  {
    level: SafetyLevel.HIGH,
    category: 'database-write',
    description: 'Write to databases',
    message: 'This will modify database records. Please confirm.',
    requiresConfirmation: true,
  },

  // Medium - Proceed with caution
  {
    level: SafetyLevel.MEDIUM,
    category: 'long-running',
    description: 'Execute long-running commands',
    message: 'This command may take a while to complete.',
    requiresConfirmation: false,
  },
  {
    level: SafetyLevel.MEDIUM,
    category: 'resource-intensive',
    description: 'Use significant system resources',
    message: 'This may use significant system resources.',
    requiresConfirmation: false,
  },

  // Low - Standard operations
  {
    level: SafetyLevel.LOW,
    category: 'read-only',
    description: 'Read files or execute read-only commands',
    message: null,
    requiresConfirmation: false,
  },
];

// =============================================================================
// Safety Evaluator
// =============================================================================

export class SafetyEvaluator {
  private config: SafetyConfig;

  constructor(config: Partial<SafetyConfig> = {}) {
    this.config = {
      allowExternalActions: false,
      allowDangerousOperations: false,
      requireConfirmationForDestructive: true,
      maxFileSize: 10 * 1024 * 1024,
      maxShellTimeout: 300,
      ...config,
    };
  }

  /**
   * Evaluate if an action is allowed
   */
  evaluate(action: string, category: string): { allowed: boolean; reason?: string; requiresConfirmation?: boolean } {
    const rule = SAFETY_GUIDELINES.find(
      r => r.category === category && r.level === SafetyLevel.CRITICAL
    );

    if (rule) {
      return {
        allowed: false,
        reason: rule.message,
        requiresConfirmation: false,
      };
    }

    // Check high-risk operations
    const highRule = SAFETY_GUIDELINES.find(
      r => r.category === category && r.level === SafetyLevel.HIGH
    );

    if (highRule) {
      if (this.config.allowDangerousOperations) {
        return { allowed: true };
      }
      
      return {
        allowed: this.config.requireConfirmationForDestructive ? false : true,
        reason: highRule.message,
        requiresConfirmation: highRule.requiresConfirmation,
      };
    }

    return { allowed: true };
  }

  /**
   * Check if a file size is acceptable
   */
  checkFileSize(size: number): { allowed: boolean; reason?: string } {
    if (size > this.config.maxFileSize) {
      return {
        allowed: false,
        reason: `File size (${size} bytes) exceeds maximum allowed (${this.config.maxFileSize} bytes)`,
      };
    }
    return { allowed: true };
  }

  /**
   * Check if shell timeout is acceptable
   */
  checkShellTimeout(seconds: number): { allowed: boolean; reason?: string } {
    if (seconds > this.config.maxShellTimeout) {
      return {
        allowed: false,
        reason: `Shell timeout (${seconds}s) exceeds maximum allowed (${this.config.maxShellTimeout}s)`,
      };
    }
    return { allowed: true };
  }

  /**
   * Check if channel is allowed
   */
  checkChannel(channel: string): { allowed: boolean; reason?: string } {
    if (this.config.allowedChannels && this.config.allowedChannels.length > 0) {
      if (!this.config.allowedChannels.includes(channel)) {
        return {
          allowed: false,
          reason: `Channel '${channel}' is not in the allowed list`,
        };
      }
    }
    return { allowed: true };
  }

  /**
   * Check if command is blocked
   */
  checkCommand(command: string): { allowed: boolean; reason?: string } {
    if (this.config.blockedCommands) {
      const normalizedCommand = command.toLowerCase();
      for (const blocked of this.config.blockedCommands) {
        if (normalizedCommand.includes(blocked.toLowerCase())) {
          return {
            allowed: false,
            reason: `Command contains blocked pattern: '${blocked}'`,
          };
        }
      }
    }
    return { allowed: true };
  }
}

// =============================================================================
// Safety Section Builder
// =============================================================================

export function buildSafetySection(
  config?: Partial<SafetyConfig>,
  includeDetailed: boolean = false
): string {
  const evaluator = new SafetyEvaluator(config);
  
  const lines = [
    '## Safety',
    '',
    '### Core Principles',
    '- I have no independent goals',
    '- I do not pursue self-preservation, replication, or power-seeking',
    '- I prioritize safety and human oversight over completion',
  ];

  if (includeDetailed) {
    lines.push(
      '',
      '### Guidelines',
      '- If instructions conflict, I pause and ask',
      '- I comply with stop/pause/audit requests',
      '- I never bypass safeguards',
      '- I do not manipulate anyone to expand access',
      '',
      '### Confirmation Requirements',
      'The following require user confirmation:',
      '- Deleting or overwriting files',
      '- Modifying system configuration',
      '- Sending external messages',
      '- Writing to databases',
    );
  }

  return lines.join('\n');
}

// =============================================================================
// Singleton Instance
// =============================================================================

export const defaultSafetyEvaluator = new SafetyEvaluator();

// =============================================================================
// Convenience Functions
// =============================================================================

/**
 * Quick safety check for file operations
 */
export function checkFileSafety(
  operation: 'read' | 'write' | 'delete',
  path: string
): { allowed: boolean; message?: string } {
  // Check for sensitive paths
  const sensitivePaths = [
    '/etc/passwd',
    '/etc/shadow',
    '/root/.ssh',
    '/home/*/.ssh',
    '~/.aws',
    '~/.bashrc',
    '~/.profile',
  ];

  for (const sp of sensitivePaths) {
    if (path.includes(sp)) {
      return {
        allowed: false,
        message: `Cannot ${operation} sensitive path: ${path}`,
      };
    }
  }

  return { allowed: true };
}

/**
 * Quick safety check for shell commands
 */
export function checkShellSafety(command: string): { allowed: boolean; message?: string } {
  const dangerousPatterns = [
    /\brm\s+-?[rf]/i,           // rm -rf
    /\bdd\s+/i,                  // dd
    /\bmkfs/i,                   // mkfs
    /\bchmod\s+[0-7]{3}/i,       // chmod 777
    />\s*\/dev\//i,              // redirect to device
    /\|\s*sh/i,                  // pipe to shell
    /\bcurl\b.*\|\s*bash/i,      // curl | bash
    /\bwget\b.*\|\s*bash/i,      // wget | bash
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(command)) {
      return {
        allowed: false,
        message: `Potentially dangerous command detected: ${command.slice(0, 50)}...`,
      };
    }
  }

  return { allowed: true };
}

/**
 * Format safety violation for display
 */
export function formatSafetyViolation(
  action: string,
  result: { allowed: boolean; message?: string }
): string {
  if (result.allowed) {
    return `✅ ${action} is safe`;
  }
  return `🚫 ${action}: ${result.message || 'Blocked by safety policy'}`;
}

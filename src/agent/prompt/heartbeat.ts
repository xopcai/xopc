// Heartbeat System - Proactive monitoring and intelligent checks
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

// =============================================================================
// Types
// =============================================================================

export interface HeartbeatConfig {
  enabled: boolean;
  interval: number; // minutes
  checks: HeartbeatCheck[];
  quietHours?: {
    start: number; // hour (0-23)
    end: number;   // hour (0-23)
  };
}

export interface HeartbeatCheck {
  name: string;
  enabled: boolean;
  interval?: number; // minutes, overrides global
  priority: 'low' | 'normal' | 'high';
}

export interface HeartbeatResult {
  check: string;
  status: 'ok' | 'warning' | 'error' | 'skipped';
  message: string;
  timestamp: Date;
  data?: Record<string, unknown>;
}

export interface HeartbeatState {
  lastChecks: Record<string, number>; // timestamp
  lastResults: Record<string, HeartbeatResult>;
}

// =============================================================================
// Default Configuration
// =============================================================================

export const DEFAULT_HEARTBEAT_CONFIG: HeartbeatConfig = {
  enabled: true,
  interval: 30, // 30 minutes
  checks: [
    {
      name: 'email',
      enabled: false,
      priority: 'high',
    },
    {
      name: 'calendar',
      enabled: true,
      priority: 'normal',
      interval: 60, // 1 hour
    },
    {
      name: 'mentions',
      enabled: true,
      priority: 'high',
      interval: 15,
    },
    {
      name: 'weather',
      enabled: false,
      priority: 'low',
    },
  ],
  quietHours: {
    start: 23,
    end: 8,
  },
};

// =============================================================================
// Heartbeat Manager
// =============================================================================

export class HeartbeatManager {
  private config: HeartbeatConfig;
  private state: HeartbeatState;
  private statePath: string;
  private timers: Map<string, NodeJS.Timeout> = new Map();

  constructor(configDir: string, config?: Partial<HeartbeatConfig>) {
    this.config = { ...DEFAULT_HEARTBEAT_CONFIG, ...config };
    this.statePath = join(configDir, 'heartbeat-state.json');
    this.state = this.loadState();
  }

  /**
   * Load state from disk
   */
  private loadState(): HeartbeatState {
    if (existsSync(this.statePath)) {
      try {
        const content = readFileSync(this.statePath, 'utf-8');
        return JSON.parse(content);
      } catch {
        return { lastChecks: {}, lastResults: {} };
      }
    }
    return { lastChecks: {}, lastResults: {} };
  }

  /**
   * Save state to disk
   */
  private saveState(): void {
    const content = JSON.stringify(this.state, null, 2);
    writeFileSync(this.statePath, content, 'utf-8');
  }

  /**
   * Check if quiet hours are active
   */
  isQuietHours(): boolean {
    if (!this.config.quietHours) return false;

    const now = new Date();
    const currentHour = now.getHours();

    const { start, end } = this.config.quietHours;

    if (start > end) {
      // Wraps around midnight (e.g., 23-7)
      return currentHour >= start || currentHour < end;
    }

    return currentHour >= start && currentHour < end;
  }

  /**
   * Check if a specific check should run
   */
  shouldRunCheck(check: HeartbeatCheck): boolean {
    if (!check.enabled) return false;
    if (this.isQuietHours()) return false;

    const lastRun = this.state.lastChecks[check.name] || 0;
    const interval = (check.interval || this.config.interval) * 60 * 1000;
    const now = Date.now();

    return (now - lastRun) >= interval;
  }

  /**
   * Execute a single check
   */
  async executeCheck(check: HeartbeatCheck): Promise<HeartbeatResult> {
    try {
      let result: HeartbeatResult;

      switch (check.name) {
        case 'email':
          result = await this.checkEmail();
          break;
        case 'calendar':
          result = await this.checkCalendar();
          break;
        case 'mentions':
          result = await this.checkMentions();
          break;
        case 'weather':
          result = await this.checkWeather();
          break;
        default:
          result = {
            check: check.name,
            status: 'skipped',
            message: `Unknown check: ${check.name}`,
            timestamp: new Date(),
          };
      }

      // Update state
      this.state.lastChecks[check.name] = Date.now();
      this.state.lastResults[check.name] = result;
      this.saveState();

      return result;
    } catch (error) {
      const result: HeartbeatResult = {
        check: check.name,
        status: 'error',
        message: `Check failed: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: new Date(),
      };

      this.state.lastChecks[check.name] = Date.now();
      this.state.lastResults[check.name] = result;
      this.saveState();

      return result;
    }
  }

  /**
   * Execute all due checks
   */
  async executeAllChecks(): Promise<HeartbeatResult[]> {
    const results: HeartbeatResult[] = [];

    for (const check of this.config.checks) {
      if (this.shouldRunCheck(check)) {
        const result = await this.executeCheck(check);
        results.push(result);
      }
    }

    return results;
  }

  // =============================================================================
  // Individual Check Implementations
  // =============================================================================

  private async checkEmail(): Promise<HeartbeatResult> {
    // Placeholder - would need email API integration
    return {
      check: 'email',
      status: 'ok',
      message: 'Email check not configured',
      timestamp: new Date(),
    };
  }

  private async checkCalendar(): Promise<HeartbeatResult> {
    // Placeholder - would need calendar API integration
    return {
      check: 'calendar',
      status: 'ok',
      message: 'Calendar check not configured',
      timestamp: new Date(),
    };
  }

  private async checkMentions(): Promise<HeartbeatResult> {
    // Placeholder - would need social media API integration
    return {
      check: 'mentions',
      status: 'ok',
      message: 'Mentions check not configured',
      timestamp: new Date(),
    };
  }

  private async checkWeather(): Promise<HeartbeatResult> {
    // Placeholder - would need weather API integration
    return {
      check: 'weather',
      status: 'ok',
      message: 'Weather check not configured',
      timestamp: new Date(),
    };
  }

  // =============================================================================
  // Public API
  // =============================================================================

  /**
   * Get current state
   */
  getState(): HeartbeatState {
    return { ...this.state };
  }

  /**
   * Get last result for a check
   */
  getLastResult(checkName: string): HeartbeatResult | undefined {
    return this.state.lastResults[checkName];
  }

  /**
   * Get all results
   */
  getAllResults(): HeartbeatResult[] {
    return Object.values(this.state.lastResults);
  }

  /**
   * Enable/disable a check
   */
  setCheckEnabled(checkName: string, enabled: boolean): boolean {
    const check = this.config.checks.find(c => c.name === checkName);
    if (!check) return false;

    check.enabled = enabled;
    return true;
  }

  /**
   * Format results for display
   */
  formatResults(results: HeartbeatResult[]): string {
    if (results.length === 0) {
      return 'No checks to report.';
    }

    const lines = ['## Heartbeat Results', ''];

    for (const result of results) {
      const icon = {
        ok: '✅',
        warning: '⚠️',
        error: '🚫',
        skipped: '⏭️',
      }[result.status];

      lines.push(`${icon} **${result.check}**: ${result.message}`);
    }

    return lines.join('\n');
  }
}

// =============================================================================
// Heartbeat Prompt Section
// =============================================================================

export function buildHeartbeatPromptSection(
  config: HeartbeatConfig,
  results: HeartbeatResult[] = []
): string {
  if (!config.enabled) {
    return '';
  }

  const lines = [
    '## Heartbeats',
    '',
    'Heartbeats enable proactive monitoring.',
    '',
    '### Available Checks',
  ];

  for (const check of config.checks) {
    const status = results.find(r => r.check === check.name);
    const statusIcon = status ? {
      ok: '✅',
      warning: '⚠️',
      error: '🚫',
      skipped: '⏭️',
    }[status.status] : '⏳';

    lines.push(`- ${statusIcon} ${check.name} (${check.priority})`);
  }

  if (config.quietHours) {
    lines.push('', `**Quiet hours**: ${config.quietHours.start}:00 - ${config.quietHours.end}:00`);
  }

  lines.push(
    '',
    'When polling and nothing needs attention, reply: `HEARTBEAT_OK`',
    'Only reply with alerts when something needs attention.',
  );

  return lines.join('\n');
}

// =============================================================================
// Singleton
// =============================================================================

let heartbeatManager: HeartbeatManager | null = null;

export function getHeartbeatManager(configDir: string): HeartbeatManager {
  if (!heartbeatManager) {
    heartbeatManager = new HeartbeatManager(configDir);
  }
  return heartbeatManager;
}

// =============================================================================
// Convenience Functions
// =============================================================================

/**
 * Quick heartbeat check
 */
export async function quickHeartbeat(configDir: string): Promise<HeartbeatResult[]> {
  const manager = getHeartbeatManager(configDir);
  return manager.executeAllChecks();
}

/**
 * Get heartbeat status summary
 */
export function getHeartbeatStatus(configDir: string): {
  enabled: boolean;
  quietHours: boolean;
  checks: number;
  results: HeartbeatResult[];
} {
  const manager = getHeartbeatManager(configDir);
  return {
    enabled: manager['config'].enabled,
    quietHours: manager.isQuietHours(),
    checks: manager['config'].checks.filter(c => c.enabled).length,
    results: manager.getAllResults(),
  };
}

/**
 * System Reminder - Contextual tips after tool execution
 * 
 * Based on Agent Harness theory: "Fixed system reminders appended after 
 * tool execution are more effective than instructions in System Prompt alone"
 * 
 * Optimized: Contextual reminders instead of fixed spam
 */

export interface SystemReminderConfig {
  enabled: boolean;
  defaultReminders: string[];
  contextualReminders: Record<string, string[]>;
  appendToToolResults: boolean;
  maxRemindersPerTurn: number;
}

// Default minimal reminders (only essentials)
const DEFAULT_REMINDERS: string[] = [];

// Contextual reminders based on tool type
const CONTEXTUAL_REMINDERS: Record<string, string[]> = {
  'file.write': ['💡 Tip: edit > write for small changes'],
  'file.delete': ['⚠️ Confirming: file deletion'],
  'shell.exec': ['🐚 Shell: use pty=true for interactive commands'],
  'web.fetch': ['🌐 Web: check for rate limits on repeated calls'],
};

const DEFAULT_CONFIG: SystemReminderConfig = {
  enabled: true,
  defaultReminders: DEFAULT_REMINDERS,
  contextualReminders: CONTEXTUAL_REMINDERS,
  appendToToolResults: true,
  maxRemindersPerTurn: 2, // Reduced from 3
};

export class SystemReminder {
  private config: SystemReminderConfig;
  private reminderCountThisTurn = 0;

  constructor(config: Partial<SystemReminderConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Get the system reminder text to append (legacy, uses default reminders)
   */
  getReminderText(): string {
    if (!this.config.enabled) {
      return '';
    }

    if (this.reminderCountThisTurn >= this.config.maxRemindersPerTurn) {
      return ''; // Don't spam too many reminders
    }

    if (this.config.defaultReminders.length === 0) {
      return '';
    }

    this.reminderCountThisTurn++;
    return this.config.defaultReminders.join('\n');
  }

  /**
   * Get contextual reminder based on tool name
   */
  getContextualReminder(toolName: string): string {
    if (!this.config.enabled) {
      return '';
    }

    if (this.reminderCountThisTurn >= this.config.maxRemindersPerTurn) {
      return '';
    }

    const reminders = this.config.contextualReminders[toolName];
    if (!reminders || reminders.length === 0) {
      return '';
    }

    this.reminderCountThisTurn++;
    // Pick first matching reminder (could randomize if multiple)
    return reminders[0];
  }

  /**
   * Append reminder to tool result content
   */
  appendToResult(result: unknown, toolName?: string): unknown {
    if (!this.config.enabled || !this.config.appendToToolResults) {
      return result;
    }

    // Try contextual reminder first, fall back to default
    const reminderText = toolName 
      ? this.getContextualReminder(toolName) 
      : this.getReminderText();
      
    if (!reminderText) {
      return result;
    }

    // Handle different result formats
    if (result && typeof result === 'object') {
      const res = result as Record<string, unknown>;
      
      if (res.content && Array.isArray(res.content)) {
        // Append to content array
        res.content = [
          ...res.content,
          { type: 'text', text: `\n${reminderText}` },
        ];
      } else if (typeof res.content === 'string') {
        // Append to string content
        res.content = `${res.content}\n${reminderText}`;
      }
      
      return res;
    }

    return result;
  }

  /**
   * Reset turn counter (called at end of turn)
   */
  resetTurn(): void {
    this.reminderCountThisTurn = 0;
  }

  /**
   * Update configuration
   */
  setConfig(config: Partial<SystemReminderConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current config
   */
  getConfig(): SystemReminderConfig {
    return { ...this.config };
  }
}

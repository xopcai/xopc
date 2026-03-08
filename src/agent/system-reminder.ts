/**
 * System Reminder - Injects fixed reminders after tool execution
 * 
 * Based on Agent Harness theory: "Fixed system reminders appended after 
 * tool execution are more effective than instructions in System Prompt alone"
 */

export interface SystemReminderConfig {
  enabled: boolean;
  reminders: string[];
  appendToToolResults: boolean;
  maxRemindersPerTurn: number;
}

const DEFAULT_REMINDERS = [
  '[System Reminder]',
  '- Always check file exists before reading',
  '- Use edit instead of write for small changes',
  '- Confirm before destructive operations (delete, remove, etc.)',
  '- Keep context under 80K tokens',
  '- Use grep/search before reading multiple files',
  '- Batch file operations when possible',
].join('\n');

const DEFAULT_CONFIG: SystemReminderConfig = {
  enabled: true,
  reminders: [DEFAULT_REMINDERS],
  appendToToolResults: true,
  maxRemindersPerTurn: 3, // Don't spam too many reminders
};

export class SystemReminder {
  private config: SystemReminderConfig;
  private reminderCountThisTurn = 0;

  constructor(config: Partial<SystemReminderConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Get the system reminder text to append
   */
  getReminderText(): string {
    if (!this.config.enabled) {
      return '';
    }

    if (this.reminderCountThisTurn >= this.config.maxRemindersPerTurn) {
      return ''; // Don't spam too many reminders
    }

    this.reminderCountThisTurn++;
    return this.config.reminders.join('\n\n');
  }

  /**
   * Append reminder to tool result content
   */
  appendToResult(result: unknown): unknown {
    if (!this.config.enabled || !this.config.appendToToolResults) {
      return result;
    }

    const reminderText = this.getReminderText();
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
          { type: 'text', text: `\n\n${reminderText}` },
        ];
      } else if (typeof res.content === 'string') {
        // Append to string content
        res.content = `${res.content}\n\n${reminderText}`;
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

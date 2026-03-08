/**
 * Progress Feedback Manager
 * 
 * Manages real-time progress feedback for long-running agent tasks.
 * Provides:
 * - Tool/end notifications execution start
 * - Thinking indicators
 * - Progress stage updates
 * - Stream integration for real-time display
 */

import { createLogger } from '../utils/logger.js';

const log = createLogger('ProgressFeedback');

// Progress stages for different operations
export type ProgressStage = 
  | 'thinking'      // AI is thinking/reasoning
  | 'searching'     // Web search
  | 'reading'      // Reading files
  | 'writing'       // Writing files  
  | 'executing'     // Running shell commands
  | 'analyzing'     // Analyzing data
  | 'idle';         // No active operation

export interface ProgressUpdate {
  stage: ProgressStage;
  detail?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  timestamp: number;
}

export interface ProgressFeedbackConfig {
  // Feedback level: minimal (errors only), normal (key events), verbose (all updates)
  level: 'minimal' | 'normal' | 'verbose';
  // Whether to show thinking indicators
  showThinking: boolean;
  // Whether to stream tool progress updates
  streamToolProgress: boolean;
  // Whether to send periodic heartbeats for long tasks
  heartbeatEnabled: boolean;
  // Heartbeat interval in ms
  heartbeatIntervalMs: number;
  // Threshold for long-running task in ms
  longTaskThresholdMs: number;
}

const DEFAULT_CONFIG: ProgressFeedbackConfig = {
  level: 'normal',
  showThinking: true,
  streamToolProgress: true,
  heartbeatEnabled: true,
  heartbeatIntervalMs: 20000, // 20 seconds
  longTaskThresholdMs: 30000, // 30 seconds
};

// Tool category mapping for better feedback
const TOOL_STAGE_MAP: Record<string, ProgressStage> = {
  'read': 'reading',
  'read_file': 'reading',
  'glob': 'reading',
  'grep': 'searching',
  'web_search': 'searching',
  'web_fetch': 'reading',
  'bash': 'executing',
  'shell': 'executing',
  'write': 'writing',
  'write_file': 'writing',
  'edit': 'writing',
  'message': 'idle',
  'memory_search': 'searching',
  'memory_get': 'reading',
};

// Emoji mapping for stages
const STAGE_EMOJI: Record<ProgressStage, string> = {
  'thinking': '🤔',
  'searching': '🔍',
  'reading': '📖',
  'writing': '✍️',
  'executing': '⚙️',
  'analyzing': '📊',
  'idle': '💬',
};

// Stage labels in English
const STAGE_LABEL: Record<ProgressStage, string> = {
  'thinking': 'Thinking',
  'searching': 'Searching',
  'reading': 'Reading',
  'writing': 'Writing',
  'executing': 'Executing',
  'analyzing': 'Analyzing',
  'idle': 'Ready',
};

export interface ProgressMessage {
  type: 'start' | 'update' | 'complete' | 'error' | 'thinking';
  stage: ProgressStage;
  message: string;
  detail?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
}

export interface ProgressCallbacks {
  onProgress?: (msg: ProgressMessage) => void;
  onStreamStart?: (toolName: string, toolArgs: Record<string, unknown>) => void;
  onStreamUpdate?: (toolName: string, partialResult: string) => void;
  onStreamEnd?: (toolName: string, result: string, isError: boolean) => void;
  onThinking?: (thinking: string) => void;
  onHeartbeat?: (elapsedMs: number, currentStage: ProgressStage) => void;
}

export class ProgressFeedbackManager {
  private config: ProgressFeedbackConfig;
  private callbacks: ProgressCallbacks = {};
  private currentStage: ProgressStage = 'idle';
  private currentTool: string | null = null;
  private taskStartTime: number = 0;
  private lastHeartbeatTime: number = 0;
  private heartbeatTimer?: ReturnType<typeof setInterval>;
  private streamActive: boolean = false;

  constructor(config: Partial<ProgressFeedbackConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  setCallbacks(callbacks: ProgressCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  startTask(): void {
    this.taskStartTime = Date.now();
    this.lastHeartbeatTime = Date.now();
    
    if (this.config.heartbeatEnabled) {
      this.startHeartbeat();
    }
  }

  endTask(): void {
    this.stopHeartbeat();
    this.currentStage = 'idle';
    this.currentTool = null;
    this.taskStartTime = 0;
    this.streamActive = false;
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      const elapsed = Date.now() - this.taskStartTime;
      if (elapsed >= this.config.longTaskThresholdMs) {
        this.callbacks.onHeartbeat?.(elapsed, this.currentStage);
        this.lastHeartbeatTime = Date.now();
      }
    }, this.config.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  private mapToolToStage(toolName: string): ProgressStage {
    const normalizedName = toolName.toLowerCase().replace(/_/g, '');
    for (const [key, stage] of Object.entries(TOOL_STAGE_MAP)) {
      if (normalizedName.includes(key)) {
        return stage;
      }
    }
    return 'executing';
  }

  private formatToolName(toolName: string): string {
    // Convert snake_case to Title Case
    return toolName
      .replace(/_/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  }

  // Handle tool execution start
  onToolStart(toolName: string, toolArgs: Record<string, unknown> = {}): void {
    if (this.config.level === 'minimal') return;

    this.currentTool = toolName;
    this.currentStage = this.mapToolToStage(toolName);
    this.streamActive = true;

    const formattedName = this.formatToolName(toolName);
    const emoji = STAGE_EMOJI[this.currentStage];
    const label = STAGE_LABEL[this.currentStage];

    // Build detail message
    let detail = '';
    if (toolArgs.path) {
      detail = `📁 ${toolArgs.path}`;
    } else if (toolArgs.query) {
      detail = `🔎 ${toolArgs.query}`;
    } else if (toolArgs.command) {
      const cmd = String(toolArgs.command);
      detail = `⚡ ${cmd.length > 50 ? cmd.slice(0, 50) + '...' : cmd}`;
    }

    const message: ProgressMessage = {
      type: 'start',
      stage: this.currentStage,
      message: `${emoji} ${label}: ${formattedName}`,
      detail: detail || undefined,
      toolName,
      toolArgs,
    };

    if (this.config.level === 'verbose' || this.config.streamToolProgress) {
      this.callbacks.onProgress?.(message);
    }
    this.callbacks.onStreamStart?.(toolName, toolArgs);

    log.debug({ toolName, stage: this.currentStage }, 'Tool execution started');
  }

  // Handle tool execution update (streaming)
  onToolUpdate(toolName: string, partialResult: unknown): void {
    if (this.config.level === 'minimal') return;
    if (!this.streamActive || !this.config.streamToolProgress) return;

    // Format partial result for display
    let displayResult = '';
    if (typeof partialResult === 'string') {
      displayResult = partialResult.slice(0, 200); // Truncate for display
    } else if (partialResult && typeof partialResult === 'object') {
      const result = partialResult as Record<string, unknown>;
      if (result.output) {
        displayResult = String(result.output).slice(0, 200);
      } else if (result.content) {
        displayResult = String(result.content).slice(0, 200);
      } else if (result.text) {
        displayResult = String(result.text).slice(0, 200);
      }
    }

    this.callbacks.onStreamUpdate?.(toolName, displayResult);
  }

  // Handle tool execution end
  onToolEnd(toolName: string, result: unknown, isError: boolean = false): void {
    if (this.config.level === 'minimal' && !isError) return;

    const wasActive = this.streamActive;
    this.streamActive = false;

    // Extract result summary
    let resultSummary = '';
    if (result && typeof result === 'object') {
      const res = result as Record<string, unknown>;
      if (res.content && Array.isArray(res.content)) {
        const textContent = res.content.find((c: unknown) => 
          typeof c === 'object' && c !== null && (c as Record<string, unknown>).type === 'text'
        );
        if (textContent) {
          resultSummary = String((textContent as Record<string, unknown>).text || '').slice(0, 100);
        }
      }
    }

    const message: ProgressMessage = {
      type: isError ? 'error' : 'complete',
      stage: this.currentStage,
      message: isError 
        ? `❌ Tool failed: ${this.formatToolName(toolName)}`
        : `✅ Done: ${this.formatToolName(toolName)}`,
      toolName,
    };

    if (wasActive) {
      this.callbacks.onStreamEnd?.(toolName, resultSummary, isError);
    }
    
    if (isError || this.config.level !== 'minimal') {
      this.callbacks.onProgress?.(message);
    }

    // Reset current tool if it matches
    if (this.currentTool === toolName) {
      this.currentTool = null;
      this.currentStage = 'idle';
    }

    log.debug({ toolName, isError }, 'Tool execution ended');
  }

  // Handle thinking/reasoning
  onThinking(thinking: string): void {
    if (!this.config.showThinking || this.config.level === 'minimal') return;

    const displayThinking = thinking.length > 100 
      ? thinking.slice(0, 100) + '...'
      : thinking;

    this.callbacks.onThinking?.(displayThinking);
  }

  // Handle turn start
  onTurnStart(): void {
    if (this.config.level === 'minimal') return;
    
    this.currentStage = 'thinking';
    this.taskStartTime = Date.now();
    
    if (this.config.heartbeatEnabled && !this.heartbeatTimer) {
      this.startHeartbeat();
    }
  }

  // Handle message/response start
  onMessageStart(): void {
    // Could be used to show "AI is typing..." indicator
  }

  // Handle message/response update (streaming tokens)
  onMessageUpdate(_content: string): void {
    // Could be used to show live response
  }

  // Handle agent end
  onAgentEnd(): void {
    this.endTask();
  }

  // Get current state
  getCurrentState(): { stage: ProgressStage; tool: string | null; elapsedMs: number } {
    return {
      stage: this.currentStage,
      tool: this.currentTool,
      elapsedMs: this.taskStartTime ? Date.now() - this.taskStartTime : 0,
    };
  }

  // Update config
  setConfig(config: Partial<ProgressFeedbackConfig>): void {
    this.config = { ...this.config, ...config };
  }

  // Get stage emoji
  getStageEmoji(stage: ProgressStage): string {
    return STAGE_EMOJI[stage] || '💬';
  }

  // Get stage label
  getStageLabel(stage: ProgressStage): string {
    return STAGE_LABEL[stage] || '未知';
  }
}

// Singleton instance with default config
export const progressFeedbackManager = new ProgressFeedbackManager();

// Utility function to format progress messages for Telegram
export function formatProgressMessage(msg: ProgressMessage, parseMode: 'Markdown' | 'HTML' = 'HTML'): string {
  const emoji = STAGE_EMOJI[msg.stage];
  
  if (parseMode === 'HTML') {
    let html = `<b>${emoji} ${msg.message}</b>`;
    if (msg.detail) {
      html += `\n${msg.detail}`;
    }
    return html;
  } else {
    let md = `**${emoji} ${msg.message}**`;
    if (msg.detail) {
      md += `\n${msg.detail}`;
    }
    return md;
  }
}

// Utility function to format heartbeat message
export function formatHeartbeatMessage(elapsedMs: number, stage: ProgressStage, detail?: string): string {
  const seconds = Math.floor(elapsedMs / 1000);
  const emoji = STAGE_EMOJI[stage];
  const label = STAGE_LABEL[stage];
  
  let message = `${emoji} Still ${label.toLowerCase()}...`;
  if (detail) {
    message += `\n${detail}`;
  }
  message += `\n⏱️ ${seconds}s elapsed`;
  
  return message;
}

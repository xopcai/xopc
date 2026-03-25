/**
 * Progress Feedback Manager Tests
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  ProgressFeedbackManager,
  progressFeedbackManager,
  formatProgressMessage,
  formatHeartbeatMessage,
  type ProgressMessage,
  type ProgressStage,
} from '../lifecycle/progress.js';

describe('ProgressFeedbackManager', () => {
  let manager: ProgressFeedbackManager;

  beforeEach(() => {
    manager = new ProgressFeedbackManager({
      level: 'normal',
      showThinking: true,
      streamToolProgress: true,
      heartbeatEnabled: true,
      heartbeatIntervalMs: 100, // Fast for testing
      longTaskThresholdMs: 50, // Short for testing
    });
  });

  afterEach(() => {
    manager.endTask();
  });

  describe('constructor', () => {
    it('should create with default config', () => {
      const m = new ProgressFeedbackManager();
      expect(m).toBeDefined();
    });

    it('should create with custom config', () => {
      const m = new ProgressFeedbackManager({
        level: 'verbose',
        showThinking: false,
        heartbeatEnabled: false,
      });
      expect(m).toBeDefined();
    });
  });

  describe('callbacks', () => {
    it('should set callbacks', () => {
      const onProgress = vi.fn();
      const onStreamStart = vi.fn();
      const onStreamEnd = vi.fn();
      const onHeartbeat = vi.fn();

      manager.setCallbacks({
        onProgress,
        onStreamStart,
        onStreamEnd,
        onHeartbeat,
      });

      // Trigger callbacks
      manager.onToolStart('read_file', { path: '/test.txt' });
      expect(onStreamStart).toHaveBeenCalledWith('read_file', { path: '/test.txt' });

      manager.onToolEnd('read_file', { content: 'test' }, false);
      expect(onStreamEnd).toHaveBeenCalled();

      manager.endTask();
    });

    it('should allow partial callback setup', () => {
      const onProgress = vi.fn();
      manager.setCallbacks({ onProgress });
      // Should not throw
      manager.onToolStart('bash', { command: 'ls' });
    });
  });

  describe('task lifecycle', () => {
    it('should start and end task', () => {
      manager.startTask();
      const state1 = manager.getCurrentState();
      expect(state1.elapsedMs).toBeGreaterThanOrEqual(0);

      manager.endTask();
      const state2 = manager.getCurrentState();
      expect(state2.stage).toBe('idle');
      expect(state2.tool).toBeNull();
    });

    it('should reset state on endTask', () => {
      manager.startTask();
      manager.onToolStart('read_file', { path: '/test.txt' });
      
      expect(manager.getCurrentState().tool).toBe('read_file');
      
      manager.endTask();
      expect(manager.getCurrentState().tool).toBeNull();
      expect(manager.getCurrentState().stage).toBe('idle');
    });
  });

  describe('tool execution', () => {
    it('should handle tool start', () => {
      const onStreamStart = vi.fn();
      manager.setCallbacks({ onStreamStart });

      manager.onToolStart('read_file', { path: '/test.txt' });

      expect(onStreamStart).toHaveBeenCalledWith('read_file', { path: '/test.txt' });
      expect(manager.getCurrentState().stage).toBe('reading');
      expect(manager.getCurrentState().tool).toBe('read_file');
    });

    it('should handle tool end', () => {
      const onStreamEnd = vi.fn();
      manager.setCallbacks({ onStreamEnd });

      manager.onToolStart('bash', { command: 'ls' });
      manager.onToolEnd('bash', { output: 'test' }, false);

      expect(onStreamEnd).toHaveBeenCalledWith('bash', '', false);
      expect(manager.getCurrentState().stage).toBe('idle');
    });

    it('should handle tool error', () => {
      const onStreamEnd = vi.fn();
      const onProgress = vi.fn();
      manager.setCallbacks({ onStreamEnd, onProgress });

      manager.onToolStart('write_file', { path: '/test.txt' });
      manager.onToolEnd('write_file', { error: 'failed' }, true);

      expect(onStreamEnd).toHaveBeenCalledWith('write_file', '', true);
      expect(onProgress).toHaveBeenCalled();
    });

    it('should map tools to correct stages', () => {
      // Test each tool separately to avoid interference
      const testTool = (toolName: string, expectedStage: ProgressStage) => {
        const m = new ProgressFeedbackManager({ level: 'normal' });
        let capturedStage: ProgressStage = 'idle';
        m.setCallbacks({
          onStreamStart: () => {
            capturedStage = m.getCurrentState().stage;
          }
        });
        m.startTask();
        m.onToolStart(toolName, {});
        m.endTask();
        expect(capturedStage).toBe(expectedStage);
      };

      testTool('read_file', 'reading');
      testTool('glob', 'reading');
      testTool('grep', 'searching');
      testTool('web_search', 'searching');
      testTool('bash', 'executing');
      testTool('shell', 'executing');
      testTool('write_file', 'writing');
      testTool('edit', 'writing');
    });

    it('should include tool args in callback', () => {
      const onStreamStart = vi.fn();
      manager.setCallbacks({ onStreamStart });

      manager.onToolStart('read_file', { path: '/home/user/file.txt' });
      expect(onStreamStart).toHaveBeenCalledWith('read_file', { path: '/home/user/file.txt' });

      manager.onToolStart('bash', { command: 'npm install' });
      expect(onStreamStart).toHaveBeenCalledWith('bash', { command: 'npm install' });
    });
  });

  describe('thinking', () => {
    it('should trigger thinking callback when enabled', () => {
      const onThinking = vi.fn();
      manager.setCallbacks({ onThinking });

      manager.onThinking('Let me think about this...');

      expect(onThinking).toHaveBeenCalledWith('Let me think about this...');
    });

    it('should not trigger thinking when disabled', () => {
      const m = new ProgressFeedbackManager({ showThinking: false });
      const onThinking = vi.fn();
      m.setCallbacks({ onThinking });

      m.onThinking('Thinking...');

      expect(onThinking).not.toHaveBeenCalled();
    });

    it('should truncate long thinking content', () => {
      const onThinking = vi.fn();
      manager.setCallbacks({ onThinking });

      const longThinking = 'A'.repeat(200);
      manager.onThinking(longThinking);

      expect(onThinking).toHaveBeenCalledWith('A'.repeat(100) + '...');
    });
  });

  describe('turn start', () => {
    it('should set thinking stage on turn start', () => {
      manager.onTurnStart();
      expect(manager.getCurrentState().stage).toBe('thinking');
    });

    it('should not trigger on turn start in minimal mode', () => {
      const m = new ProgressFeedbackManager({ level: 'minimal' });
      const onProgress = vi.fn();
      m.setCallbacks({ onProgress });

      m.onTurnStart();

      expect(onProgress).not.toHaveBeenCalled();
    });
  });

  describe('heartbeat', () => {
    it('should trigger heartbeat for long tasks', async () => {
      const onHeartbeat = vi.fn();
      
      // Create manager with very short intervals for testing
      const testManager = new ProgressFeedbackManager({
        heartbeatEnabled: true,
        heartbeatIntervalMs: 10,
        longTaskThresholdMs: 5,
      });
      
      testManager.setCallbacks({ onHeartbeat });
      testManager.startTask();

      // Wait for heartbeat to trigger
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Heartbeat should have been called at least once
      expect(onHeartbeat).toHaveBeenCalled();
      
      testManager.endTask();
    });

    it('should not trigger heartbeat when disabled', () => {
      const m = new ProgressFeedbackManager({ heartbeatEnabled: false });
      const onHeartbeat = vi.fn();
      m.setCallbacks({ onHeartbeat });

      m.startTask();
      m.onToolStart('bash', {});

      // No heartbeat should be triggered
      expect(onHeartbeat).not.toHaveBeenCalled();
      m.endTask();
    });
  });

  describe('config updates', () => {
    it('should update config', () => {
      manager.setConfig({ level: 'verbose' });
      // Should not throw
      expect(manager.getCurrentState()).toBeDefined();
    });
  });

  describe('getStageEmoji and getStageLabel', () => {
    it('should return correct emoji for stages', () => {
      expect(manager.getStageEmoji('thinking')).toBe('🤔');
      expect(manager.getStageEmoji('searching')).toBe('🔍');
      expect(manager.getStageEmoji('reading')).toBe('📖');
      expect(manager.getStageEmoji('writing')).toBe('✍️');
      expect(manager.getStageEmoji('executing')).toBe('⚙️');
      expect(manager.getStageEmoji('analyzing')).toBe('📊');
      expect(manager.getStageEmoji('idle')).toBe('💬');
    });

    it('should return correct labels', () => {
      expect(manager.getStageLabel('thinking')).toBe('Thinking');
      expect(manager.getStageLabel('searching')).toBe('Searching');
      expect(manager.getStageLabel('reading')).toBe('Reading');
      expect(manager.getStageLabel('writing')).toBe('Writing');
      expect(manager.getStageLabel('executing')).toBe('Executing');
      expect(manager.getStageLabel('analyzing')).toBe('Analyzing');
      expect(manager.getStageLabel('idle')).toBe('Ready');
    });
  });

  describe('feedback level control', () => {
    it('should suppress progress in minimal mode', () => {
      const m = new ProgressFeedbackManager({ level: 'minimal' });
      const onProgress = vi.fn();
      const onStreamStart = vi.fn();
      m.setCallbacks({ onProgress, onStreamStart });

      m.onToolStart('read_file', {});
      
      // In minimal mode, onProgress should not be called (but stream start might still fire)
      expect(onProgress).not.toHaveBeenCalled();
      m.endTask();
    });

    it('should suppress tool updates in minimal mode', () => {
      const m = new ProgressFeedbackManager({ level: 'minimal' });
      const onProgress = vi.fn();
      m.setCallbacks({ onProgress });

      m.onToolEnd('read_file', { content: 'test' }, false);
      
      expect(onProgress).not.toHaveBeenCalled();
    });

    it('should still show errors in minimal mode', () => {
      const m = new ProgressFeedbackManager({ level: 'minimal' });
      const onProgress = vi.fn();
      m.setCallbacks({ onProgress });

      m.onToolEnd('read_file', { error: 'failed' }, true);
      
      expect(onProgress).toHaveBeenCalled();
    });
  });
});

describe('formatProgressMessage', () => {
  it('should format start message', () => {
    const msg: ProgressMessage = {
      type: 'start',
      stage: 'reading',
      message: 'Reading: Read File',
      detail: '📁 /test.txt',
    };

    const result = formatProgressMessage(msg, 'HTML');
    expect(result).toContain('📖');
    expect(result).toContain('Reading: Read File');
    expect(result).toContain('/test.txt');
  });

  it('should format error message', () => {
    const msg: ProgressMessage = {
      type: 'error',
      stage: 'executing',
      message: '❌ Tool failed: Bash',
    };

    const result = formatProgressMessage(msg, 'HTML');
    expect(result).toContain('❌');
    expect(result).toContain('Tool failed');
  });

  it('should format complete message', () => {
    const msg: ProgressMessage = {
      type: 'complete',
      stage: 'writing',
      message: '✅ Done: Write File',
    };

    const result = formatProgressMessage(msg, 'HTML');
    expect(result).toContain('✅');
    expect(result).toContain('Done');
  });

  it('should handle Markdown format', () => {
    const msg: ProgressMessage = {
      type: 'start',
      stage: 'searching',
      message: 'Searching: Grep',
    };

    const result = formatProgressMessage(msg, 'Markdown');
    expect(result).toContain('**');
  });
});

describe('formatHeartbeatMessage', () => {
  it('should format heartbeat with seconds', () => {
    const result = formatHeartbeatMessage(45000, 'executing');
    expect(result).toContain('45s elapsed');
  });

  it('should include stage label', () => {
    const result = formatHeartbeatMessage(10000, 'reading');
    expect(result).toContain('Still reading');
    expect(result).toContain('📖');
  });

  it('should include detail when provided', () => {
    const result = formatHeartbeatMessage(30000, 'executing', 'npm install');
    expect(result).toContain('npm install');
  });

  it('should handle different stages', () => {
    const stages: ProgressStage[] = ['thinking', 'searching', 'reading', 'writing', 'executing', 'analyzing'];
    
    stages.forEach(stage => {
      const result = formatHeartbeatMessage(10000, stage);
      expect(result).toContain('Still');
    });
  });
});

describe('Singleton instance', () => {
  it('should export singleton manager', () => {
    expect(progressFeedbackManager).toBeDefined();
    expect(progressFeedbackManager).toBeInstanceOf(ProgressFeedbackManager);
  });
});

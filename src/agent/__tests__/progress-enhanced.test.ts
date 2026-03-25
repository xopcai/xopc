/**
 * Progress Feedback Manager - Enhanced Features Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ProgressFeedbackManager } from '../lifecycle/progress.js';

describe('ProgressFeedbackManager - Enhanced', () => {
  let manager: ProgressFeedbackManager;
  let progressMessages: any[];

  beforeEach(() => {
    progressMessages = [];
    manager = new ProgressFeedbackManager({
      level: 'normal',
      showErrorAccumulation: true,
      showRequestLimitWarning: true,
    });
    
    manager.setCallbacks({
      onProgress: (msg) => {
        progressMessages.push(msg);
      },
    });
  });

  describe('onToolErrorAccumulated', () => {
    it('should notify on first tool failure', () => {
      manager.onToolErrorAccumulated('shell', 1, 3, 2);
      
      expect(progressMessages).toHaveLength(1);
      expect(progressMessages[0].type).toBe('warning');
      expect(progressMessages[0].message).toContain('Shell failed 1 time');
      expect(progressMessages[0].detail).toContain('Remaining attempts: 2');
    });

    it('should notify with warning at 50% failures', () => {
      manager.onToolErrorAccumulated('shell', 2, 3, 1);
      
      expect(progressMessages).toHaveLength(1);
      expect(progressMessages[0].type).toBe('warning');
      expect(progressMessages[0].message).toContain('Shell failed 2/3 times');
      expect(progressMessages[0].detail).toContain('Remaining attempts: 1');
    });

    it('should notify with error at 100% failures', () => {
      manager.onToolErrorAccumulated('shell', 3, 3, 0);
      
      expect(progressMessages).toHaveLength(1);
      expect(progressMessages[0].type).toBe('error');
      expect(progressMessages[0].message).toContain('has reached maximum failures');
      expect(progressMessages[0].detail).toContain('Stopping tool execution');
    });

    it('should not notify when showErrorAccumulation is false', () => {
      const noErrorManager = new ProgressFeedbackManager({
        level: 'normal',
        showErrorAccumulation: false,
      });
      
      noErrorManager.setCallbacks({
        onProgress: (msg) => progressMessages.push(msg),
      });
      
      noErrorManager.onToolErrorAccumulated('shell', 1, 3, 2);
      expect(progressMessages).toHaveLength(0);
    });

    it('should not notify in minimal level', () => {
      const minimalManager = new ProgressFeedbackManager({
        level: 'minimal',
        showErrorAccumulation: true,
      });
      
      minimalManager.setCallbacks({
        onProgress: (msg) => progressMessages.push(msg),
      });
      
      minimalManager.onToolErrorAccumulated('shell', 1, 3, 2);
      expect(progressMessages).toHaveLength(0);
    });

    it('should format tool name correctly', () => {
      manager.onToolErrorAccumulated('read_file', 1, 3, 2);
      
      expect(progressMessages[0].message).toContain('Read File');
    });
  });

  describe('onRequestLimitStatus', () => {
    it('should not notify when not warning and not stopping', () => {
      manager.onRequestLimitStatus(10, 50, 40, false, false);
      expect(progressMessages).toHaveLength(0);
    });

    it('should notify warning when approaching limit', () => {
      manager.onRequestLimitStatus(40, 50, 10, true, false);
      
      expect(progressMessages).toHaveLength(1);
      expect(progressMessages[0].type).toBe('warning');
      expect(progressMessages[0].message).toContain('Approaching request limit');
      expect(progressMessages[0].detail).toContain('Remaining requests: 10');
    });

    it('should notify warning at 90%', () => {
      manager.onRequestLimitStatus(45, 50, 5, true, false);
      
      expect(progressMessages).toHaveLength(1);
      expect(progressMessages[0].message).toContain('Request limit warning');
    });

    it('should notify error when limit reached', () => {
      manager.onRequestLimitStatus(50, 50, 0, true, true);
      
      expect(progressMessages).toHaveLength(1);
      expect(progressMessages[0].type).toBe('error');
      expect(progressMessages[0].message).toContain('Request limit reached');
      expect(progressMessages[0].detail).toContain('Stopping execution');
    });

    it('should not notify when showRequestLimitWarning is false', () => {
      const noWarningManager = new ProgressFeedbackManager({
        level: 'normal',
        showRequestLimitWarning: false,
      });
      
      noWarningManager.setCallbacks({
        onProgress: (msg) => progressMessages.push(msg),
      });
      
      noWarningManager.onRequestLimitStatus(45, 50, 5, true, false);
      expect(progressMessages).toHaveLength(0);
    });

    it('should not notify in minimal level', () => {
      const minimalManager = new ProgressFeedbackManager({
        level: 'minimal',
        showRequestLimitWarning: true,
      });
      
      minimalManager.setCallbacks({
        onProgress: (msg) => progressMessages.push(msg),
      });
      
      minimalManager.onRequestLimitStatus(45, 50, 5, true, false);
      expect(progressMessages).toHaveLength(0);
    });
  });

  describe('configuration', () => {
    it('should respect showErrorAccumulation config', () => {
      const enabledManager = new ProgressFeedbackManager({
        level: 'normal',
        showErrorAccumulation: true,
      });
      
      enabledManager.setCallbacks({
        onProgress: (msg) => progressMessages.push(msg),
      });
      
      enabledManager.onToolErrorAccumulated('shell', 1, 3, 2);
      expect(progressMessages).toHaveLength(1);
    });

    it('should respect showRequestLimitWarning config', () => {
      const enabledManager = new ProgressFeedbackManager({
        level: 'normal',
        showRequestLimitWarning: true,
      });
      
      enabledManager.setCallbacks({
        onProgress: (msg) => progressMessages.push(msg),
      });
      
      enabledManager.onRequestLimitStatus(45, 50, 5, true, false);
      expect(progressMessages).toHaveLength(1);
    });

    it('should use default config values', () => {
      const defaultManager = new ProgressFeedbackManager();
      
      // Should have enhanced features enabled by default
      defaultManager.setCallbacks({
        onProgress: (msg) => progressMessages.push(msg),
      });
      
      defaultManager.onToolErrorAccumulated('shell', 1, 3, 2);
      expect(progressMessages).toHaveLength(1);
      
      progressMessages = [];
      defaultManager.onRequestLimitStatus(45, 50, 5, true, false);
      expect(progressMessages).toHaveLength(1);
    });
  });

  describe('message formatting', () => {
    it('should format tool name from snake_case', () => {
      manager.onToolErrorAccumulated('read_file', 1, 3, 2);
      expect(progressMessages[0].message).toContain('Read File');
    });

    it('should format tool name with underscores', () => {
      manager.onToolErrorAccumulated('web_search', 1, 3, 2);
      expect(progressMessages[0].message).toContain('Web Search');
    });

    it('should include tool name in message', () => {
      manager.onToolErrorAccumulated('shell', 1, 3, 2);
      expect(progressMessages[0].toolName).toBe('shell');
    });

    it('should include stage in message', () => {
      manager.onToolErrorAccumulated('shell', 1, 3, 2);
      expect(progressMessages[0].stage).toBe('executing');
      
      progressMessages = [];
      manager.onRequestLimitStatus(45, 50, 5, true, false);
      expect(progressMessages[0].stage).toBe('thinking');
    });
  });

  describe('edge cases', () => {
    it('should handle zero maxFailures gracefully', () => {
      manager.onToolErrorAccumulated('shell', 0, 0, 0);
      expect(progressMessages).toHaveLength(1);
      // 0/0 = 0%, so it's a warning
      expect(progressMessages[0].type).toBe('warning');
    });

    it('should handle zero limit gracefully', () => {
      manager.onRequestLimitStatus(0, 0, 0, false, false);
      expect(progressMessages).toHaveLength(0); // Should not notify
    });

    it('should handle negative remaining attempts', () => {
      manager.onToolErrorAccumulated('shell', 5, 3, -2);
      expect(progressMessages[0].detail).toContain('Stopping tool execution');
    });

    it('should handle undefined remaining attempts', () => {
      manager.onToolErrorAccumulated('shell', 1, 3);
      expect(progressMessages[0].detail).toContain('Remaining attempts: 2');
    });
  });
});

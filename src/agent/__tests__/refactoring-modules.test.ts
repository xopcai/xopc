/**
 * Quick verification test for refactored AgentService modules
 */

import { describe, it, expect } from 'vitest';

// Test messaging layer
import { MessageRouter, CommandHandler, StreamManager } from '../messaging/index.js';

// Test session layer  
import { SessionContextManager, SessionLifecycleManager } from '../session/index.js';

// Test orchestration layer
import { AgentOrchestrator, AgentEventHandler } from '../orchestration/index.js';

// Test skills layer
import { SkillManager } from '../skills/skill-manager.js';

describe('Refactored AgentService Modules', () => {
  describe('Messaging Layer', () => {
    it('should export MessageRouter', () => {
      expect(MessageRouter).toBeDefined();
    });

    it('should export CommandHandler', () => {
      expect(CommandHandler).toBeDefined();
    });

    it('should export StreamManager', () => {
      expect(StreamManager).toBeDefined();
    });
  });

  describe('Session Layer', () => {
    it('should export SessionContextManager', () => {
      expect(SessionContextManager).toBeDefined();
    });

    it('should export SessionLifecycleManager', () => {
      expect(SessionLifecycleManager).toBeDefined();
    });
  });

  describe('Orchestration Layer', () => {
    it('should export AgentOrchestrator', () => {
      expect(AgentOrchestrator).toBeDefined();
    });

    it('should export AgentEventHandler', () => {
      expect(AgentEventHandler).toBeDefined();
    });
  });

  describe('Skills Layer', () => {
    it('should export SkillManager', () => {
      expect(SkillManager).toBeDefined();
    });
  });
});

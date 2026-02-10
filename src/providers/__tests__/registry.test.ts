import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ModelRegistry } from '../registry.js';
import * as piAi from '@mariozechner/pi-ai';

// Mock pi-ai module
vi.mock('@mariozechner/pi-ai', async () => {
  const actual = await vi.importActual<typeof import('@mariozechner/pi-ai')>('@mariozechner/pi-ai');
  return {
    ...actual,
    getProviders: vi.fn(() => ['google', 'minimax']),
    getModels: vi.fn((provider: string) => {
      if (provider === 'google') {
        return [
          { id: 'gemini-2.5-flash', provider: 'google', api: 'google-generative-ai' },
          { id: 'gemini-2.5-pro', provider: 'google', api: 'google-generative-ai' },
        ];
      }
      if (provider === 'minimax') {
        // Note: pi-ai uses uppercase 'MiniMax-M2.1' format
        return [
          { id: 'MiniMax-M2', provider: 'minimax', api: 'anthropic-messages' },
          { id: 'MiniMax-M2.1', provider: 'minimax', api: 'anthropic-messages' },
        ];
      }
      return [];
    }),
  };
});

describe('ModelRegistry', () => {
  let registry: ModelRegistry;

  beforeEach(() => {
    registry = new ModelRegistry(null, { ollamaEnabled: false });
  });

  describe('loadBuiltInModels', () => {
    it('should load models from pi-ai', () => {
      const all = registry.getAll();
      expect(all.length).toBeGreaterThan(0);
    });

    it('should have correct provider and id format from pi-ai', () => {
      const models = registry.getAll();
      const minimaxModels = models.filter(m => m.provider === 'minimax');
      
      // pi-ai returns uppercase format
      expect(minimaxModels).toContainEqual(
        expect.objectContaining({ id: 'MiniMax-M2.1', provider: 'minimax' })
      );
    });
  });

  describe('find', () => {
    it('should find google model by exact match', () => {
      const model = registry.find('google', 'gemini-2.5-flash');
      expect(model).toBeDefined();
      expect(model?.id).toBe('gemini-2.5-flash');
    });

    it('should return undefined for non-existent model', () => {
      const model = registry.find('google', 'non-existent');
      expect(model).toBeUndefined();
    });
  });

  describe('findByRef', () => {
    it('should find by provider/model format (google)', () => {
      const model = registry.findByRef('google/gemini-2.5-flash');
      expect(model).toBeDefined();
      expect(model?.id).toBe('gemini-2.5-flash');
    });

    it('should find by provider/model format (minimax - case insensitive)', () => {
      // BUG FIX: user passes 'minimax/minimax-m2.1' and pi-ai has 'MiniMax-M2.1'
      // Now works with case-insensitive matching
      const model = registry.findByRef('minimax/minimax-m2.1');
      
      expect(model).toBeDefined();
      expect(model?.id).toBe('MiniMax-M2.1');
      expect(model?.provider).toBe('minimax');
    });

    it('should find with various case combinations', () => {
      // All these should find the same model
      const variants = [
        'minimax/MiniMax-M2.1',
        'minimax/minimax-m2.1',
        'MINIMAX/MINIMAX-M2.1',
        'Minimax/Minimax-M2.1',
      ];
      
      for (const ref of variants) {
        const model = registry.findByRef(ref);
        expect(model, `Should find model for ref: ${ref}`).toBeDefined();
        expect(model?.id).toBe('MiniMax-M2.1');
      }
    });

    it('should find by exact case (current workaround)', () => {
      // Current workaround: use exact case from pi-ai
      const model = registry.findByRef('minimax/MiniMax-M2.1');
      expect(model).toBeDefined();
      expect(model?.id).toBe('MiniMax-M2.1');
    });

    it('should find by model id only (fallback)', () => {
      // When no slash, should match any provider with that model id
      const model = registry.findByRef('MiniMax-M2.1');
      expect(model).toBeDefined();
      expect(model?.id).toBe('MiniMax-M2.1');
    });
  });

  describe('model loading verification', () => {
    it('should verify pi-ai models are loaded correctly', () => {
      const models = registry.getAll();
      
      // Check google models
      expect(models.some(m => m.provider === 'google' && m.id === 'gemini-2.5-flash')).toBe(true);
      
      // Check minimax models (note the case)
      expect(models.some(m => m.provider === 'minimax' && m.id === 'MiniMax-M2.1')).toBe(true);
    });

    it('should handle empty config gracefully', () => {
      const emptyRegistry = new ModelRegistry(null, { ollamaEnabled: false });
      expect(emptyRegistry.getAll().length).toBeGreaterThan(0);
    });
  });
});

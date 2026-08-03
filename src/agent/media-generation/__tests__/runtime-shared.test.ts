import { describe, expect, it } from 'vitest';

import type { Config, AgentModelConfig } from '../../../config/schema.js';
import { FailoverError, type FallbackAttempt } from '../../failover-error.js';
import {
  buildMediaGenerationNormalizationMetadata,
  buildNoCapabilityModelConfiguredMessage,
  recordCapabilityCandidateFailure,
  resolveCapabilityModelCandidates,
  resolveClosestAspectRatio,
  resolveClosestResolution,
  resolveClosestSize,
  throwCapabilityGenerationFailure,
  type CapabilityProviderCandidate,
} from '../runtime-shared.js';

const emptyCfg = {} as unknown as Config;

describe('resolveCapabilityModelCandidates', () => {
  const listProviders = (): CapabilityProviderCandidate[] => [];

  it('returns [] when nothing is configured', () => {
    const candidates = resolveCapabilityModelCandidates({
      cfg: emptyCfg,
      modelConfig: undefined,
      listProviders,
    });
    expect(candidates).toEqual([]);
  });

  it('orders override → primary → fallbacks → autoFallback', () => {
    const modelConfig: AgentModelConfig = {
      primary: 'openai/gpt-image-2',
      fallbacks: ['dashscope/wan2.6-t2i', 'minimax/image-01'],
    };
    const providers: CapabilityProviderCandidate[] = [
      { id: 'google', defaultModel: 'gemini-3.1-flash-image', isConfigured: () => true },
      { id: 'fal', defaultModel: 'flux-pro', isConfigured: () => false },
    ];
    const candidates = resolveCapabilityModelCandidates({
      cfg: emptyCfg,
      modelConfig,
      modelOverride: 'override/model-x',
      listProviders: () => providers,
      autoProviderFallback: true,
    });
    expect(candidates).toEqual([
      { provider: 'override', model: 'model-x' },
      { provider: 'openai', model: 'gpt-image-2' },
      { provider: 'dashscope', model: 'wan2.6-t2i' },
      { provider: 'minimax', model: 'image-01' },
      { provider: 'google', model: 'gemini-3.1-flash-image' },
    ]);
  });

  it('deduplicates by case-insensitive provider + exact model', () => {
    const modelConfig: AgentModelConfig = {
      primary: 'OpenAI/gpt-image-2',
      fallbacks: ['openai/gpt-image-2', 'openai/gpt-image-1.5'],
    };
    const candidates = resolveCapabilityModelCandidates({
      cfg: emptyCfg,
      modelConfig,
      listProviders,
    });
    expect(candidates).toEqual([
      { provider: 'openai', model: 'gpt-image-2' },
      { provider: 'openai', model: 'gpt-image-1.5' },
    ]);
  });

  it('skips invalid refs silently', () => {
    const candidates = resolveCapabilityModelCandidates({
      cfg: emptyCfg,
      modelConfig: { primary: 'no-slash', fallbacks: ['openai/gpt-image-2', '/empty', ''] },
      listProviders,
    });
    expect(candidates).toEqual([{ provider: 'openai', model: 'gpt-image-2' }]);
  });

  it('listProviders throwing does not break autoFallback', () => {
    const candidates = resolveCapabilityModelCandidates({
      cfg: emptyCfg,
      modelConfig: { primary: 'openai/x' },
      listProviders: () => {
        throw new Error('boom');
      },
      autoProviderFallback: true,
    });
    expect(candidates).toEqual([{ provider: 'openai', model: 'x' }]);
  });

  it('uses the active agent scope when checking automatic fallback providers', () => {
    const candidates = resolveCapabilityModelCandidates({
      cfg: emptyCfg,
      agentId: 'studio',
      modelConfig: undefined,
      listProviders: () => [{
        id: 'google',
        defaultModel: 'gemini-3.1-flash-image',
        isConfigured: ({ agentId }) => agentId === 'studio',
      }],
      autoProviderFallback: true,
    });

    expect(candidates).toEqual([
      { provider: 'google', model: 'gemini-3.1-flash-image' },
    ]);
  });
});

describe('resolveClosestSize', () => {
  it('returns the requested size verbatim when supported', () => {
    expect(
      resolveClosestSize({
        requestedSize: '1024x1024',
        supportedSizes: ['1024x1024', '1024x1536'],
      }),
    ).toBe('1024x1024');
  });

  it('picks the nearest supported size when not exact', () => {
    expect(
      resolveClosestSize({
        requestedSize: '1024x768',
        supportedSizes: ['1024x1024', '1024x1536', '1536x1024'],
      }),
    ).toBe('1024x1024'); // closest in area + ratio (4:3 vs 1:1 vs 2:3 vs 3:2)
  });

  it('derives a size from aspectRatio when requestedSize is absent', () => {
    const result = resolveClosestSize({
      requestedAspectRatio: '16:9',
      supportedSizes: ['1024x1024', '1536x1024', '1024x1536'],
    });
    expect(result).toBe('1536x1024'); // closest to 16:9
  });

  it('returns undefined when supportedSizes is empty', () => {
    expect(resolveClosestSize({ requestedSize: '1024x1024' })).toBeUndefined();
  });

  it('falls back to first supported when no signal is provided', () => {
    expect(resolveClosestSize({ supportedSizes: ['512x512', '1024x1024'] })).toBe('512x512');
  });
});

describe('resolveClosestAspectRatio', () => {
  it('returns the requested ratio when supported', () => {
    expect(
      resolveClosestAspectRatio({
        requestedAspectRatio: '16:9',
        supportedAspectRatios: ['1:1', '16:9', '9:16'],
      }),
    ).toBe('16:9');
  });

  it('derives a ratio from requestedSize when no aspectRatio is given', () => {
    expect(
      resolveClosestAspectRatio({
        requestedSize: '1920x1080',
        supportedAspectRatios: ['1:1', '16:9', '4:3'],
      }),
    ).toBe('16:9');
  });

  it('picks the closest available ratio', () => {
    expect(
      resolveClosestAspectRatio({
        requestedAspectRatio: '21:9',
        supportedAspectRatios: ['1:1', '16:9', '4:3'],
      }),
    ).toBe('16:9');
  });
});

describe('resolveClosestResolution', () => {
  it('returns exact match', () => {
    expect(
      resolveClosestResolution({ requestedResolution: '2K' as const, supportedResolutions: ['1K', '2K', '4K'] }),
    ).toBe('2K');
  });

  it('picks the largest supported value <= requested', () => {
    expect(
      resolveClosestResolution({ requestedResolution: '4K' as const, supportedResolutions: ['1K', '2K'] }),
    ).toBe('2K');
  });

  it('returns undefined when no support list is provided', () => {
    expect(resolveClosestResolution({ requestedResolution: '4K' as const })).toBeUndefined();
  });

  it('returns undefined when no requested value is provided', () => {
    expect(resolveClosestResolution({ supportedResolutions: ['1K', '2K'] })).toBeUndefined();
  });
});

describe('recordCapabilityCandidateFailure + throwCapabilityGenerationFailure', () => {
  it('records a structured attempt and throws FailoverError', () => {
    const attempts: FallbackAttempt[] = [];
    recordCapabilityCandidateFailure({
      attempts,
      provider: 'openai',
      model: 'gpt-image-2',
      error: new Error('boom'),
      durationMs: 123,
    });
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      provider: 'openai',
      model: 'gpt-image-2',
      reason: 'unknown',
      durationMs: 123,
    });

    expect(() =>
      throwCapabilityGenerationFailure({
        capabilityLabel: 'image generation',
        attempts,
        lastError: new Error('boom'),
      }),
    ).toThrow(FailoverError);

    try {
      throwCapabilityGenerationFailure({
        capabilityLabel: 'image generation',
        attempts,
        lastError: new Error('boom'),
      });
    } catch (e) {
      expect(e).toBeInstanceOf(FailoverError);
      expect((e as FailoverError).capability).toBe('image-generation');
    }
  });
});

describe('buildNoCapabilityModelConfiguredMessage', () => {
  it('formats with registered providers and env hints', () => {
    const msg = buildNoCapabilityModelConfiguredMessage({
      capabilityLabel: 'image-generation',
      modelConfigKey: 'imageGenerationModel',
      providers: [
        { id: 'openai', defaultModel: 'gpt-image-2' },
        { id: 'dashscope', defaultModel: 'wan2.7-image-pro' },
      ],
      getProviderEnvVars: (id) => (id === 'openai' ? ['OPENAI_API_KEY'] : ['DASHSCOPE_API_KEY']),
    });
    expect(msg).toContain('No image-generation model configured');
    expect(msg).toContain('manifest/runtime model policy');
    expect(msg).toContain('- openai default=gpt-image-2 (env: OPENAI_API_KEY)');
    expect(msg).toContain('- dashscope default=wan2.7-image-pro (env: DASHSCOPE_API_KEY)');
  });

  it('omits the providers section when none registered', () => {
    const msg = buildNoCapabilityModelConfiguredMessage({
      capabilityLabel: 'image-generation',
      modelConfigKey: 'imageGenerationModel',
      providers: [],
    });
    expect(msg).not.toContain('Registered providers');
  });
});

describe('buildMediaGenerationNormalizationMetadata', () => {
  it('returns {} when normalization is empty', () => {
    expect(buildMediaGenerationNormalizationMetadata({})).toEqual({});
    expect(buildMediaGenerationNormalizationMetadata({ normalization: {} })).toEqual({});
  });

  it('wraps normalization under metadata.normalization', () => {
    const out = buildMediaGenerationNormalizationMetadata({
      normalization: { size: { requested: '1024x768', applied: '1024x1024' } },
    });
    expect(out).toEqual({
      normalization: { size: { requested: '1024x768', applied: '1024x1024' } },
    });
  });
});

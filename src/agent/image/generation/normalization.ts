/**
 * Image-generation parameter normalization.
 *
 * Reconciles user-supplied geometry / output overrides against the active
 * provider's declared {@link ImageGenerationProviderCapabilities}. Returns:
 *   - the actually-applied values to forward to the provider
 *   - per-field {@link MediaNormalizationEntry} (requested / applied / derivedFrom)
 *   - a list of {@link ImageGenerationIgnoredOverride} entries for unsupported
 *     soft fields (so the LLM / UI can surface a Note)
 *
 * Hard errors (unsupported edit, too many input images) are thrown so the
 * caller can fail fast — they are NOT downgraded to ignored overrides.
 *
 * Decision table — see docs/image-generation-rearchitecture.md §6.3
 */

import {
  resolveClosestAspectRatio,
  resolveClosestResolution,
  resolveClosestSize,
} from '../../media-generation/index.js';
import type {
  ImageGenerationBackground,
  ImageGenerationCapabilitiesLegacy,
  ImageGenerationGeometryCapability,
  ImageGenerationIgnoredOverride,
  ImageGenerationIgnoredOverrideKey,
  ImageGenerationNormalization,
  ImageGenerationOutputFormat,
  ImageGenerationProvider,
  ImageGenerationProviderCapabilities,
  ImageGenerationQuality,
  ImageGenerationResolution,
  ImageGenerationSourceImage,
} from './types.js';

/**
 * Narrow `provider.capabilities` to the new nested shape. The registry accepts
 * the legacy flat shape too, but normalization only understands the new one;
 * legacy fields surface here as `undefined`.
 */
function asNewCapabilities(
  caps: ImageGenerationProviderCapabilities | ImageGenerationCapabilitiesLegacy | undefined,
): ImageGenerationProviderCapabilities {
  if (!caps) return {};
  // Legacy flat shape exposes `supportsEdit` (boolean). When seen, treat as
  // an empty new-shape capability map so normalization defaults kick in.
  if ((caps as ImageGenerationCapabilitiesLegacy).supportsEdit !== undefined &&
      (caps as ImageGenerationProviderCapabilities).generate === undefined &&
      (caps as ImageGenerationProviderCapabilities).edit === undefined) {
    return {};
  }
  return caps as ImageGenerationProviderCapabilities;
}

export interface ResolveImageGenerationOverridesParams {
  provider: ImageGenerationProvider;
  size?: string;
  aspectRatio?: string;
  resolution?: ImageGenerationResolution;
  quality?: ImageGenerationQuality;
  outputFormat?: ImageGenerationOutputFormat;
  background?: ImageGenerationBackground;
  inputImages?: ImageGenerationSourceImage[];
}

export interface ResolvedImageGenerationOverrides {
  size?: string;
  aspectRatio?: string;
  resolution?: ImageGenerationResolution;
  quality?: ImageGenerationQuality;
  outputFormat?: ImageGenerationOutputFormat;
  background?: ImageGenerationBackground;
  ignoredOverrides: ImageGenerationIgnoredOverride[];
  normalization?: ImageGenerationNormalization;
}

export function resolveImageGenerationOverrides(
  params: ResolveImageGenerationOverridesParams,
): ResolvedImageGenerationOverrides {
  const provider = params.provider;
  const caps = asNewCapabilities(provider.capabilities);
  const isEdit = (params.inputImages?.length ?? 0) > 0;

  // Hard checks (throw, do not downgrade) ---------------------------------
  assertEditSupported(provider, isEdit, params.inputImages);

  const modeCaps = isEdit ? caps.edit : caps.generate;
  const supportsSize = modeCaps?.supportsSize === true;
  const supportsAspectRatio = modeCaps?.supportsAspectRatio === true;
  const supportsResolution = caps.generate?.supportsResolution === true && !isEdit;

  const ignoredOverrides: ImageGenerationIgnoredOverride[] = [];
  const normalization: ImageGenerationNormalization = {};

  // Geometry --------------------------------------------------------------
  const { size, aspectRatio, resolution } = resolveGeometry({
    requestedSize: params.size,
    requestedAspectRatio: params.aspectRatio,
    requestedResolution: params.resolution,
    supportsSize,
    supportsAspectRatio,
    supportsResolution,
    geometry: caps.geometry,
    ignoredOverrides,
    normalization,
  });

  // Soft fields (drop into ignoredOverrides on mismatch) -----------------
  const quality = filterEnumOverride<'quality', ImageGenerationQuality>({
    key: 'quality',
    requested: params.quality,
    supported: caps.output?.qualities,
    ignoredOverrides,
  });
  const outputFormat = filterEnumOverride<'outputFormat', ImageGenerationOutputFormat>({
    key: 'outputFormat',
    requested: params.outputFormat,
    supported: caps.output?.formats,
    ignoredOverrides,
  });
  const background = filterEnumOverride<'background', ImageGenerationBackground>({
    key: 'background',
    requested: params.background,
    supported: caps.output?.backgrounds,
    ignoredOverrides,
  });

  return {
    ...(size !== undefined ? { size } : {}),
    ...(aspectRatio !== undefined ? { aspectRatio } : {}),
    ...(resolution !== undefined ? { resolution } : {}),
    ...(quality !== undefined ? { quality } : {}),
    ...(outputFormat !== undefined ? { outputFormat } : {}),
    ...(background !== undefined ? { background } : {}),
    ignoredOverrides,
    ...(hasAnyEntry(normalization) ? { normalization } : {}),
  };
}

// ============================================
// Geometry decision table (§6.3)
// ============================================

interface ResolveGeometryParams {
  requestedSize?: string;
  requestedAspectRatio?: string;
  requestedResolution?: ImageGenerationResolution;
  supportsSize: boolean;
  supportsAspectRatio: boolean;
  supportsResolution: boolean;
  geometry: ImageGenerationGeometryCapability | undefined;
  ignoredOverrides: ImageGenerationIgnoredOverride[];
  normalization: ImageGenerationNormalization;
}

function resolveGeometry(params: ResolveGeometryParams): {
  size?: string;
  aspectRatio?: string;
  resolution?: ImageGenerationResolution;
} {
  const supportedSizes = params.geometry?.sizes;
  const supportedAspectRatios = params.geometry?.aspectRatios;
  const supportedResolutions = params.geometry?.resolutions;

  let size: string | undefined;
  let aspectRatio: string | undefined;
  let resolution: ImageGenerationResolution | undefined;

  // ----- size -----------------------------------------------------------
  if (params.requestedSize) {
    if (params.supportsSize) {
      const applied = resolveClosestSize({
        requestedSize: params.requestedSize,
        supportedSizes,
      });
      if (applied) {
        size = applied;
        params.normalization.size = entry({
          requested: params.requestedSize,
          applied,
          supportedValues: supportedSizes,
        });
      } else {
        // No supported list → forward as-is.
        size = params.requestedSize;
      }
    } else if (params.supportsAspectRatio) {
      const derived = resolveClosestAspectRatio({
        requestedSize: params.requestedSize,
        supportedAspectRatios,
      });
      if (derived) {
        aspectRatio = derived;
        params.normalization.aspectRatio = entry({
          applied: derived,
          derivedFrom: 'size',
          supportedValues: supportedAspectRatios,
        });
      } else {
        ignored(params.ignoredOverrides, 'size', params.requestedSize);
      }
    } else {
      ignored(params.ignoredOverrides, 'size', params.requestedSize);
    }
  }

  // ----- aspectRatio -----------------------------------------------------
  if (params.requestedAspectRatio) {
    if (params.supportsAspectRatio) {
      const applied = resolveClosestAspectRatio({
        requestedAspectRatio: params.requestedAspectRatio,
        supportedAspectRatios,
      });
      const finalApplied = applied ?? params.requestedAspectRatio;
      aspectRatio = finalApplied;
      params.normalization.aspectRatio = entry({
        requested: params.requestedAspectRatio,
        applied: finalApplied,
        supportedValues: supportedAspectRatios,
      });
    } else if (params.supportsSize && size === undefined) {
      const derived = resolveClosestSize({
        requestedAspectRatio: params.requestedAspectRatio,
        supportedSizes,
      });
      if (derived) {
        size = derived;
        params.normalization.size = entry({
          applied: derived,
          derivedFrom: 'aspectRatio',
          supportedValues: supportedSizes,
        });
      } else {
        ignored(params.ignoredOverrides, 'aspectRatio', params.requestedAspectRatio);
      }
    } else if (!params.supportsSize) {
      ignored(params.ignoredOverrides, 'aspectRatio', params.requestedAspectRatio);
    }
    // else: size already supplied and provider only supports size → ignore
    //       to avoid contradiction; record in ignoredOverrides as well.
    if (
      !params.supportsAspectRatio &&
      params.supportsSize &&
      size !== undefined &&
      params.normalization.size?.derivedFrom !== 'aspectRatio'
    ) {
      ignored(params.ignoredOverrides, 'aspectRatio', params.requestedAspectRatio);
    }
  }

  // ----- resolution ------------------------------------------------------
  if (params.requestedResolution) {
    if (params.supportsResolution) {
      const applied = resolveClosestResolution({
        requestedResolution: params.requestedResolution,
        supportedResolutions,
      });
      const finalApplied = applied ?? params.requestedResolution;
      resolution = finalApplied;
      params.normalization.resolution = entry({
        requested: params.requestedResolution,
        applied: finalApplied,
        supportedValues: supportedResolutions,
      });
    } else {
      ignored(params.ignoredOverrides, 'resolution', params.requestedResolution);
    }
  }

  return { size, aspectRatio, resolution };
}

// ============================================
// Hard-check helpers
// ============================================

function assertEditSupported(
  provider: ImageGenerationProvider,
  isEdit: boolean,
  inputImages: ImageGenerationSourceImage[] | undefined,
): void {
  if (!isEdit) return;
  const caps = asNewCapabilities(provider.capabilities);
  const editCap = caps.edit;
  const enabled = editCap?.enabled === true;
  if (!enabled) {
    throw new Error(`${provider.id} image editing is not supported.`);
  }
  const max = editCap.maxInputImages;
  if (typeof max === 'number' && (inputImages?.length ?? 0) > max) {
    throw new Error(
      `${provider.id} accepts at most ${max} input image(s); got ${inputImages?.length ?? 0}.`,
    );
  }
}

// ============================================
// Tiny helpers
// ============================================

interface FilterEnumOverrideParams<TKey extends ImageGenerationIgnoredOverrideKey, TValue extends string> {
  key: TKey;
  requested: TValue | undefined;
  supported: ReadonlyArray<TValue> | undefined;
  ignoredOverrides: ImageGenerationIgnoredOverride[];
}

function filterEnumOverride<TKey extends ImageGenerationIgnoredOverrideKey, TValue extends string>(
  params: FilterEnumOverrideParams<TKey, TValue>,
): TValue | undefined {
  if (params.requested === undefined) return undefined;
  if (!params.supported || params.supported.length === 0) {
    // Provider declares no constraint → forward.
    return params.requested;
  }
  if (params.supported.includes(params.requested)) return params.requested;
  ignored(params.ignoredOverrides, params.key, params.requested);
  return undefined;
}

function ignored(
  list: ImageGenerationIgnoredOverride[],
  key: ImageGenerationIgnoredOverrideKey,
  value: string,
): void {
  list.push({ key, value });
}

function entry<T extends string>(init: {
  requested?: T;
  applied?: T;
  derivedFrom?: 'size' | 'aspectRatio' | 'resolution';
  supportedValues?: ReadonlyArray<T>;
}) {
  return {
    ...(init.requested !== undefined ? { requested: init.requested } : {}),
    ...(init.applied !== undefined ? { applied: init.applied } : {}),
    ...(init.derivedFrom !== undefined ? { derivedFrom: init.derivedFrom } : {}),
    ...(init.supportedValues ? { supportedValues: [...init.supportedValues] } : {}),
  };
}

function hasAnyEntry(n: ImageGenerationNormalization): boolean {
  return (
    n.size !== undefined || n.aspectRatio !== undefined || n.resolution !== undefined
  );
}

// Re-export for convenience so callers don't need a second import.
export type { ImageGenerationProviderCapabilities };

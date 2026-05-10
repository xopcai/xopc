/**
 * Optional gateway-console hints for image provider credentials (regions, base URL presets).
 * Vendors attach {@link ImageGenerationProvider.ui} at registration time.
 */

export type ImageProviderUiRegionOption = {
  value: string;
  /** English label; web maps by `value` for zh. */
  label: string;
  imageBaseUrl: string;
};

export type ImageProviderUiBaseUrlPreset = {
  value: string;
  label: string;
};

export type ImageProviderUiPresetKind = 'fal' | 'minimax' | 'google' | 'openai';

export type ImageProviderUiMetadata = {
  regions?: ImageProviderUiRegionOption[];
  baseUrlPresets?: ImageProviderUiBaseUrlPreset[];
  baseUrlPresetKind?: ImageProviderUiPresetKind;
};

import './builtin.js';

export type {
  VoiceCapability,
  VoiceConfigFieldMetadata,
  VoiceConfigFieldType,
  VoiceOptionMetadata,
  VoiceProviderDiagnosticMetadata,
  VoiceProviderMetadata,
  VoiceProviderMetadataPayload,
  VoiceProviderMetadataPayloadEntry,
} from './types.js';

export {
  registerVoiceProviderMetadata,
  getVoiceProviderMetadata,
  listVoiceProviderMetadata,
} from './registry.js';

export { builtinVoiceProviderMetadata } from './builtin.js';

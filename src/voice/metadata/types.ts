export type VoiceCapability = 'stt' | 'tts';

export type VoiceConfigFieldType = 'string' | 'password' | 'number' | 'boolean' | 'select' | 'textarea';

export interface VoiceOptionMetadata {
  id: string;
  name: string;
  description?: string;
}

export interface VoiceConfigFieldMetadata {
  key: string;
  label: string;
  type: VoiceConfigFieldType;
  required?: boolean;
  secret?: boolean;
  placeholder?: string;
  description?: string;
  options?: VoiceOptionMetadata[];
  defaultValue?: string | number | boolean;
  min?: number;
  max?: number;
  step?: number;
}

export interface VoiceProviderDiagnosticMetadata {
  requiresApiKey: boolean;
  envKeys?: string[];
  configPath: string;
}

export interface VoiceProviderMetadata {
  id: string;
  capability: VoiceCapability;
  displayName: string;
  description?: string;
  aliases?: string[];
  models?: VoiceOptionMetadata[];
  voices?: VoiceOptionMetadata[];
  fields: VoiceConfigFieldMetadata[];
  diagnostics: VoiceProviderDiagnosticMetadata;
}

export interface VoiceProviderMetadataPayloadEntry extends VoiceProviderMetadata {
  configured: boolean;
}

export interface VoiceProviderMetadataPayload {
  providers: VoiceProviderMetadataPayloadEntry[];
  active: string;
}

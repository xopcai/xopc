/**
 * Extension manifest — control-plane metadata (readable without loading extension code).
 * New fields are optional for backward compatibility.
 */

import type { ExtensionKind } from './core.js';

export interface ExtensionManifest {
  id: string;
  name: string;
  description?: string;
  version?: string;
  kind?: ExtensionKind;
  main?: string;
  configSchema?: Record<string, unknown>;
  dependencies?: Record<string, string>;

  enabledByDefault?: boolean;
  legacyExtensionIds?: string[];

  providers?: string[];
  providerAuthEnvVars?: Record<string, string[]>;
  providerAuthChoices?: ProviderAuthChoice[];
  modelSupport?: ModelSupportDeclaration;
  autoEnableWhenConfiguredProviders?: string[];

  channels?: string[];
  channelEnvVars?: Record<string, string[]>;

  activation?: ActivationDeclaration;
  contracts?: ContractDeclaration;
  setup?: SetupDeclaration;
}

export interface ProviderAuthChoice {
  provider: string;
  method: 'api-key' | 'oauth' | 'cli' | 'env';
  choiceId: string;
  choiceLabel: string;
  choiceHint?: string;
  groupId?: string;
  groupLabel?: string;
  groupHint?: string;
  cliFlag?: string;
  cliOption?: string;
  cliDescription?: string;
}

export interface ModelSupportDeclaration {
  modelPrefixes?: string[];
  modelPatterns?: string[];
}

export interface ActivationDeclaration {
  onProviders?: string[];
  onCommands?: string[];
  onChannels?: string[];
  onCapabilities?: Array<'provider' | 'channel' | 'tool' | 'hook'>;
}

export interface ContractDeclaration {
  mediaUnderstandingProviders?: string[];
  speechProviders?: string[];
  imageGenerationProviders?: string[];
  webSearchProviders?: string[];
  memoryProviders?: string[];
}

export interface SetupDeclaration {
  providers?: SetupProviderDeclaration[];
  requiresRuntime?: boolean;
}

export interface SetupProviderDeclaration {
  id: string;
  authMethods?: string[];
  envVars?: string[];
}

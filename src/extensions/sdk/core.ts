/**
 * Core extension types — prefer `@xopcai/xopc/extension-sdk/core` over the full SDK barrel when tree-shaking.
 */

export type {
  ExtensionDefinition,
  ExtensionModule,
  ExtensionKind,
  ExtensionApi,
  ExtensionLogger,
  ExtensionRegistry,
  ExtensionRuntime,
  ExtensionCliRegistration,
} from '../types/core.js';

export type { ExtensionRecord, ResolvedExtensionConfig } from '../types/loader.js';

export type { ExtensionManifest } from '../types/manifest.js';

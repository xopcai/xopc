export type ProviderSystemPromptSectionId =
  | 'interaction_style'
  | 'tool_call_style'
  | 'execution_bias';

export type ProviderSystemPromptContribution = {
  /** Cache-stable provider guidance inserted above the prompt cache boundary. */
  stablePrefix?: string;
  /** Provider guidance inserted below the cache boundary. */
  dynamicSuffix?: string;
  /** Whole-section replacements for selected core prompt sections. */
  sectionOverrides?: Partial<Record<ProviderSystemPromptSectionId, string>>;
};

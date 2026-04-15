/**
 * Loose TypeScript surface for config objects passed through extension APIs and loaders.
 * (Runtime validation lives in schema / zod elsewhere.)
 */
export interface Config {
  agents?: {
    defaults?: {
      workspace?: string;
      model?: string;
      maxTokens?: number;
      temperature?: number;
      max_tool_iterations?: number;
      memory?: {
        enabled?: boolean;
        useEnhancedSystem?: boolean;
        userProfileEnabled?: boolean;
        memoryCharLimit?: number;
        userCharLimit?: number;
        provider?: 'none' | 'stub';
        injectionFrequency?: 'every-turn' | 'first-turn';
        contextCadence?: number;
        dialecticCadence?: number;
      };
      sessionSearch?: {
        summaryModel?: string;
      };
    };
  };
  channels?: Record<string, unknown>;
  gateway?: {
    host?: string;
    port?: number;
  };
  tools?: {
    web?: {
      region?: 'cn' | 'global';
      search?: {
        maxResults?: number;
        providers?: Array<{
          type: 'brave' | 'tavily' | 'bing' | 'searxng';
          apiKey?: string;
          url?: string;
          disabled?: boolean;
        }>;
      };
    };
  };
  extensions?: {
    enabled?: string[];
    allow?: string[];
    security?: {
      checkPermissions?: boolean;
      allowUntrusted?: boolean;
      trackProvenance?: boolean;
      allowPromptInjection?: boolean;
    };
    slots?: {
      memory?: string;
      tts?: string;
      imageGeneration?: string;
      webSearch?: string;
    };
    [key: string]: unknown;
  };
}

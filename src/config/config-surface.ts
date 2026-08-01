/**
 * Loose TypeScript surface for config objects passed through extension APIs and loaders.
 * (Runtime validation lives in schema / zod elsewhere.)
 */
export interface Config {
  channels?: Record<string, unknown>;
  gateway?: {
    host?: string;
    port?: number;
  };
  tui?: {
    defaultAgent?: string;
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

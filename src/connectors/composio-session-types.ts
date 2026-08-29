import type { ToolRouterCreateSessionConfig } from '@composio/core';

export type ComposioAuthConfigOption = {
  id: string;
  name: string;
  status: 'ENABLED' | 'DISABLED';
  authScheme?: string;
  isComposioManaged: boolean;
  isEnabledForToolRouter: boolean;
};

export type ComposioToolkitAuthState = {
  toolkit: string;
  managedAuthAvailable: boolean;
  requiresCustomAuthConfig: boolean;
  authConfigs: ComposioAuthConfigOption[];
};

type SessionToolkitResponse = {
  items: Array<{
    slug: string;
    name: string;
    logo?: string;
    isNoAuth: boolean;
    connection?: {
      isActive: boolean;
      connectedAccount?: { status: string; id: string };
    };
  }>;
  cursor?: string;
};

export type ComposioSessionLike = {
  sessionId: string;
  toolkits(options?: { toolkits?: string[]; isConnected?: boolean; limit?: number; cursor?: string }): Promise<SessionToolkitResponse>;
  authorize(toolkit: string, options?: { callbackUrl?: string; alias?: string }): Promise<{
    id: string;
    status: string;
    redirectUrl?: string | null;
  }>;
  search(params: { query: string; toolkits?: string[] }): Promise<unknown>;
  execute(toolSlug: string, args?: Record<string, unknown>, options?: { account?: string }): Promise<unknown>;
};

export type ComposioSessionsClient = {
  mode?: 'managed' | 'byok';
  sessions: {
    create(userId: string, config?: ToolRouterCreateSessionConfig): Promise<ComposioSessionLike>;
  };
  connectedAccounts: {
    list(query?: { userIds?: string[]; toolkitSlugs?: string[] }): Promise<unknown>;
    delete(id: string): Promise<unknown>;
    refresh(id: string): Promise<unknown>;
  };
  authConfigs?: {
    list(query?: { toolkit?: string; showDisabled?: boolean }): Promise<{
      items: Array<{
        id: string;
        name: string;
        status: 'ENABLED' | 'DISABLED';
        authScheme?: string;
        isComposioManaged?: boolean;
        isEnabledForToolRouter?: boolean;
      }>;
    }>;
  };
  toolkits?: {
    get(slug: string): Promise<{
      composioManagedAuthSchemes?: string[];
      authConfigDetails?: unknown[];
    }>;
  };
};

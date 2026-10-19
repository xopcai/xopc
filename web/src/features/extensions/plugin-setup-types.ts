export type PluginAuthMethod = {
  id: string; title: string; type: 'oauth' | 'form' | 'cli';
  fields?: string[]; server?: string; instructions?: string[]; helpUrl?: string;
};
export type PluginAccount = { id: string; title: string; description?: string; servers: string[]; methods: PluginAuthMethod[] };
export type PluginSetupJob = {
  revision: number; state: string; resources: string; installed?: boolean; deferred?: boolean;
  partial: boolean; missingConfig?: string[]; error?: string;
  authorizations?: Array<{ id: string; state: string; method?: string }>;
  connections: Array<{ name: string; state: string; toolCount?: number }>;
};
export type PluginAuthorizationAttempt = {
  id: string; state: string; authorizationUrl?: string; acceptsRedirect?: boolean;
  challenge?: { type: 'url' | 'qr'; url: string; message?: string }; expiresAt?: number; error?: string;
};

export type ModelSetupUse = 'chat' | 'vision' | 'image' | 'background' | 'speech' | 'transcription' | 'conversation';
export type ModelSetupChoice = { id: string; name: string };
export type ProviderSetupProfile = {
  id: string;
  brand: string;
  name: string;
  access: 'account' | 'subscription' | 'api' | 'local';
  credential: 'oauth' | 'api-key' | 'none';
  interactiveOnly: boolean;
  apiKeyUrl?: string;
};
export type ModelSetupRequest = {
  mode?: 'fill' | 'replace';
  selected?: ModelSetupUse[];
  overrides?: Partial<Record<ModelSetupUse, string>>;
  modelIds?: string[];
};
export type ModelSetupPreview = {
  providerId: string;
  profile: ProviderSetupProfile;
  revision: string;
  configured: boolean;
  mode: 'fill' | 'replace';
  uses: Array<{
    id: ModelSetupUse;
    current?: string;
    recommended?: string;
    choices: ModelSetupChoice[];
    selected: boolean;
    reason?: 'not_supported' | 'interactive_only' | 'no_recommendation';
  }>;
  taskModels: Partial<Record<'fast' | 'reasoning' | 'coding' | 'review' | 'vision' | 'understanding', string>>;
};

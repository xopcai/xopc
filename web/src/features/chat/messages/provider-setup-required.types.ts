export type ProviderSetupPayload = {
  kind: 'provider_setup_required' | 'provider_auth_invalid';
  provider: string;
  deepLink: string;
  message?: string;
};

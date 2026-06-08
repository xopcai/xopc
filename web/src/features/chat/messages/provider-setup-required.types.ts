export type ProviderSetupPayload = {
  kind: 'provider_setup_required';
  provider: string;
  deepLink: string;
  message?: string;
};

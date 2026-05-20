/** Shared registration secret for Tunnel Broker (MVP). Override in production. */
export function resolveTunnelRegistrationSecret(env: NodeJS.ProcessEnv = process.env): string {
  return env.XOPC_TUNNEL_REGISTRATION_SECRET ?? 'dev-registration-secret';
}

export function resolveTunnelBrokerUrl(
  configBrokerUrl: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return env.XOPC_TUNNEL_BROKER_URL ?? configBrokerUrl ?? 'https://frp.xopc.ai/api';
}

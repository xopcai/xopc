export type PluginEntryPoint = 'connections' | 'skills' | 'installed';

export function pluginDetailPath(id: string, from: PluginEntryPoint, connect = false, returnTo?: string) {
  return `/capabilities/extensions/${encodeURIComponent(id)}?${new URLSearchParams({ from, ...(connect ? { connect: '1' } : {}), ...(returnTo ? { returnTo } : {}) })}`;
}

export function pluginReturnPath(from: string | null, returnTo?: string | null) {
  if (returnTo && /^\/capabilities\/(skills|connectors|extensions)(?:\?|$)/.test(returnTo) && !/[\\#\r\n]/.test(returnTo)) return returnTo;
  if (from === 'connections') return '/capabilities/connectors?tab=connected';
  if (from === 'skills') return '/capabilities/skills?tab=installed&source=plugin';
  return '/capabilities/extensions?tab=user';
}

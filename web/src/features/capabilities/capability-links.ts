export type PluginEntryPoint = 'connections' | 'skills' | 'installed';

export function pluginDetailPath(id: string, from: PluginEntryPoint, connect = false, returnTo?: string) {
  const [path, query] = pluginReturnPath(from, returnTo).split('?');
  const params = new URLSearchParams(query);
  params.set('plugin', id);
  if (connect) params.set('connect', '1');
  else params.delete('connect');
  return `${path}?${params}`;
}

export function pluginReturnPath(from: string | null, returnTo?: string | null) {
  if (returnTo && /^\/capabilities\/(skills|connectors|extensions)(?:\?|$)/.test(returnTo) && !/[\\#\r\n]/.test(returnTo)) return returnTo;
  if (from === 'connections') return '/capabilities/connectors?tab=connected';
  if (from === 'skills') return '/capabilities/skills?tab=installed&source=plugin';
  return '/capabilities/extensions?tab=user';
}

export function pluginStartPath(name: string, zh: boolean) {
  return `/chat/new?${new URLSearchParams({ draft: zh ? `请帮我使用${name}插件。` : `Help me use the ${name} plugin.`, projectScope: 'none' })}`;
}

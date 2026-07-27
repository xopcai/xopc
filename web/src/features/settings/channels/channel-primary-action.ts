import type { ChannelActionDescriptor, ChannelCatalogEntry } from './use-channel-catalog';

export function choosePrimaryChannelAction(
  entry: ChannelCatalogEntry,
): [string, ChannelActionDescriptor] | null {
  const actions = entry.actions ?? {};
  const preferredQr = ['login.start', 'setup.start'];
  for (const id of preferredQr) {
    const action = actions[id];
    if (action?.result === 'qr') return [id, action];
  }
  const firstQr = Object.entries(actions).find(([, action]) => action.result === 'qr');
  if (firstQr) return firstQr;

  const declaredPrimary = entry.ui?.card?.primaryAction;
  if (declaredPrimary && actions[declaredPrimary]) {
    return [declaredPrimary, actions[declaredPrimary]];
  }

  const preferred = ['login.start', 'setup.start'];
  for (const id of preferred) {
    const action = actions[id];
    if (action) return [id, action];
  }
  return Object.entries(actions).find(([, action]) => action.result === 'form') ?? null;
}

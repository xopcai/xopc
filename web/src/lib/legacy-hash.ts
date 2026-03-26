/**
 * Normalize legacy Lit UI hashes (`#sessions`, `#chat`, …) to React Router hash paths (`#/sessions`, `#/chat`).
 */
export function bootstrapLegacyHash(): void {
  const raw = window.location.hash.slice(1);
  if (!raw) return;

  if (raw === 'sessions') {
    window.history.replaceState(null, '', '#/settings/sessions');
    return;
  }
  if (raw === 'logs') {
    window.history.replaceState(null, '', '#/settings/logs');
    return;
  }

  const legacyTabs = ['cron', 'skills'] as const;
  if ((legacyTabs as readonly string[]).includes(raw)) {
    window.history.replaceState(null, '', `#/${raw}`);
    return;
  }

  if (raw === 'settings') {
    window.history.replaceState(null, '', '#/settings/appearance');
    return;
  }

  const legacySettings: Record<string, string> = {
    settingsAppearance: 'appearance',
    settingsAgent: 'agent',
    settingsProviders: 'providers',
    settingsModels: 'models',
    settingsChannels: 'channels',
    settingsVoice: 'voice',
    settingsGateway: 'gateway',
    settingsHeartbeat: 'heartbeat',
  };
  if (raw in legacySettings) {
    window.history.replaceState(null, '', `#/settings/${legacySettings[raw]}`);
    return;
  }

  if (raw === 'chat' || raw.startsWith('chat/')) {
    const suffix = raw === 'chat' ? '' : raw.slice('chat'.length);
    const normalized = suffix.startsWith('/') ? suffix : `/${suffix}`;
    window.history.replaceState(null, '', `#/chat${normalized === '/' ? '' : normalized}`);
  }
}

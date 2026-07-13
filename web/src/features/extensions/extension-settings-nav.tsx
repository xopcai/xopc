/**
 * ExtensionSettingsNav — settings left-rail links for `settingsPanels` contributions.
 */

import { Bug, Puzzle } from 'lucide-react';
import { NavLink } from 'react-router-dom';

import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

import { extensionHasProviderCredentialsSettings } from './extension-ui-guards';
import { useUiExtensions } from './extension-provider';
import type { ExtensionUiInfo, SettingsPanelContribution } from './types';

interface ExtensionSettingsNavProps {
  navLinkClassName: (props: { isActive: boolean }) => string;
  showAdvanced?: boolean;
}

export function ExtensionSettingsNav({ navLinkClassName, showAdvanced = true }: ExtensionSettingsNavProps) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const uiExtensions = useUiExtensions();

  const settingsPanels = collectSettingsPanels(uiExtensions);

  if (!showAdvanced) {
    return null;
  }

  return (
    <div>
      <p className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
        {m.settingsNavGroups.extensions}
      </p>
      <div className="flex flex-col gap-0.5">
        <NavLink to="/settings/extensions/debug" className={navLinkClassName}>
          <Bug className="size-5 shrink-0 opacity-90" strokeWidth={1.75} aria-hidden />
          <span className="min-w-0 flex-1 truncate">{m.extensionDebug.nav}</span>
        </NavLink>
        {settingsPanels.map(({ extension, panel }) => {
          const path = `/settings/ext/${extension.id}/${panel.id}`;
          return (
            <NavLink key={`${extension.id}:${panel.id}`} to={path} className={navLinkClassName}>
              <Puzzle className="size-5 shrink-0 opacity-90" strokeWidth={1.75} aria-hidden />
              <span className="min-w-0 flex-1 truncate">{panel.title}</span>
            </NavLink>
          );
        })}
        {configOnlyExtensions(uiExtensions).map((extension) => (
          <NavLink
            key={`${extension.id}:config`}
            to={`/settings/ext/${extension.id}`}
            className={navLinkClassName}
          >
            <Puzzle className="size-5 shrink-0 opacity-90" strokeWidth={1.75} aria-hidden />
            <span className="min-w-0 flex-1 truncate">{extension.name}</span>
          </NavLink>
        ))}
      </div>
    </div>
  );
}

function collectSettingsPanels(
  extensions: ExtensionUiInfo[],
): Array<{ extension: ExtensionUiInfo; panel: SettingsPanelContribution }> {
  const result: Array<{ extension: ExtensionUiInfo; panel: SettingsPanelContribution }> = [];
  for (const extension of extensions) {
    const panels = extension.ui?.contributions?.settingsPanels;
    if (!panels) continue;
    for (const panel of panels) {
      result.push({ extension, panel });
    }
  }
  result.sort((a, b) => {
    const orderA = a.panel.order ?? 999;
    const orderB = b.panel.order ?? 999;
    if (orderA !== orderB) return orderA - orderB;
    return a.panel.title.localeCompare(b.panel.title);
  });
  return result;
}

function configOnlyExtensions(extensions: ExtensionUiInfo[]): ExtensionUiInfo[] {
  return extensions.filter(
    (e) =>
      (Boolean(e.hasConfigSchema) || extensionHasProviderCredentialsSettings(e)) &&
      !(
        Array.isArray(e.ui?.contributions?.settingsPanels) &&
        e.ui.contributions.settingsPanels.length > 0
      ),
  );
}

import { Languages, Palette, Type } from 'lucide-react';

import { FontScaleToggle } from '@/components/shell/font-scale-toggle';
import { LanguageToggle } from '@/components/shell/language-toggle';
import { ThemeToggle } from '@/components/shell/theme-toggle';
import { SettingsFormSection, SettingsFormSectionHeader } from '@/features/settings/settings-form-section';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

export function AppearanceSettingsPanel() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const a = m.appearanceSettings;

  return (
    <div className="mx-auto flex w-full max-w-app-main flex-col gap-6 px-4 py-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold tracking-tight text-fg">{m.settingsSections.appearance}</h1>
        <p className="text-sm text-fg-muted">{a.subtitle}</p>
      </header>

      <SettingsFormSection>
        <SettingsFormSectionHeader
          icon={Languages}
          title={a.languageTitle}
          subtitle={a.languageDescription}
        />
        <LanguageToggle />
      </SettingsFormSection>

      <SettingsFormSection>
        <SettingsFormSectionHeader
          icon={Palette}
          title={a.themeTitle}
          subtitle={a.themeDescription}
        />
        <ThemeToggle />
      </SettingsFormSection>

      <SettingsFormSection>
        <SettingsFormSectionHeader
          icon={Type}
          title={a.fontScaleTitle}
          subtitle={a.fontScaleDescription}
        />
        <FontScaleToggle
          ariaLabel={a.fontScaleTitle}
          labels={{
            compact: a.fontScaleCompact,
            default: a.fontScaleDefault,
            large: a.fontScaleLarge,
          }}
        />
      </SettingsFormSection>
    </div>
  );
}

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const personal = readFileSync(new URL('../entry/src/main/ets/view/PersonalView.ets', import.meta.url), 'utf8');
const settings = readFileSync(new URL('../entry/src/main/ets/view/SettingsView.ets', import.meta.url), 'utf8');
const components = readFileSync(new URL('../entry/src/main/ets/view/MobileComponents.ets', import.meta.url), 'utf8');

describe('personal page card layout', () => {
  it('links the configured assistant, personal information and goals from the profile page', () => {
    expect(personal).toContain('this.record?.displayName');
    expect(personal).toContain("page: 'personal-agent-profile'");
    expect(personal).toContain("page: 'about-you'");
    expect(personal).toContain("page: 'personal-goals'");
    expect(personal).toContain('.bindSheet($$this.goalEditorOpen, this.goalEditor');
  });

  it('groups low-frequency controls under settings', () => {
    expect(settings).toContain("XopcSectionLabel({ heading: $r('app.string.settings_connection_notifications') })");
    expect(settings).toContain("XopcSectionLabel({ heading: $r('app.string.settings_data_sharing') })");
    expect(settings).toContain("heading: $r('app.string.notifications')");
    expect(settings).toContain("heading: $r('app.string.share_center')");
    expect(settings).toContain("this.onNavigate({ page: 'sharing', itemId: '' })");
  });

  it('keeps shared row icons comfortably inset from both card edges', () => {
    expect(components).toContain(
      '.padding({ left: this.compact ? 12 : 16, right: this.compact ? 12 : 16,',
    );
  });
});

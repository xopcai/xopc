import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const personal = readFileSync(new URL('../entry/src/main/ets/view/PersonalView.ets', import.meta.url), 'utf8');
const settings = readFileSync(new URL('../entry/src/main/ets/view/SettingsView.ets', import.meta.url), 'utf8');
const components = readFileSync(new URL('../entry/src/main/ets/view/MobileComponents.ets', import.meta.url), 'utf8');

describe('personal page card layout', () => {
  it('keeps high-value personal understanding on the tab and moves system controls out', () => {
    expect(personal).toContain("Text($r('app.string.personal_goals'))");
    expect(personal).toContain('this.goalRow(goal)');
    expect(personal).toContain('.bindSheet($$this.goalEditorOpen, this.goalEditor');
    expect(personal).toContain("this.sectionHeading($r('app.string.personal_understanding_title'))");
    expect(personal).toContain("XopcSectionLabel({ heading: $r('app.string.about_you_recent') })");
    expect(personal).toContain("XopcSectionLabel({ heading: $r('app.string.about_you_rules') })");
    expect(personal).not.toContain("XopcSectionLabel({ heading: $r('app.string.device_status') })");
    expect(personal).not.toContain("heading: $r('app.string.notifications')");
    expect(personal).not.toContain("heading: $r('app.string.share_center')");
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

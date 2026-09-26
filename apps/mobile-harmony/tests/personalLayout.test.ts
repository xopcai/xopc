import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const personal = readFileSync(new URL('../entry/src/main/ets/view/PersonalView.ets', import.meta.url), 'utf8');
const components = readFileSync(new URL('../entry/src/main/ets/view/MobileComponents.ets', import.meta.url), 'utf8');

describe('personal page card layout', () => {
  it('renders connection and notifications as independent cards', () => {
    const deviceSection = personal.slice(
      personal.indexOf("XopcSectionLabel({ heading: $r('app.string.device_status') })"),
      personal.indexOf("XopcSectionLabel({ heading: $r('app.string.preferences') })"),
    );

    expect(deviceSection.match(/XopcHubRow\(/g)).toHaveLength(2);
    expect(deviceSection).not.toContain('.backgroundColor(this.colors.grouped)');
  });

  it('keeps shared row icons comfortably inset from both card edges', () => {
    expect(components).toContain(
      '.padding({ left: this.compact ? 12 : 16, right: this.compact ? 12 : 16,',
    );
  });
});

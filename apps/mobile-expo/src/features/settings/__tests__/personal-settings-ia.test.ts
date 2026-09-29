import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const personal = readFileSync(new URL('../PersonalScreen.tsx', import.meta.url), 'utf8');
const settings = readFileSync(new URL('../SettingsScreen.tsx', import.meta.url), 'utf8');

describe('personal and settings information architecture', () => {
  it('keeps personal understanding and recent context on You', () => {
    expect(personal).toContain('profile.data.goals.map');
    expect(personal).toContain('<GoalEditorModal');
    expect(personal).toContain('understanding.counts');
    expect(personal).toContain('profile.data.recent.slice(0, 3)');
    expect(personal).toContain('profile.data.rules.slice(0, 3)');
    expect(personal).not.toContain('m.personalServices');
    expect(personal).not.toContain('m.deviceStatus');
  });

  it('moves low-frequency management actions to Settings', () => {
    expect(settings).toContain('s.sectionConnection');
    expect(settings).toContain('s.sectionSharing');
    expect(settings).toContain("router.push('/ai/agents')");
    expect(settings).toContain("router.push('/sharing')");
    expect(settings).toContain('s.sectionPreferences');
    expect(settings).toContain('s.sectionAbout');
  });
});

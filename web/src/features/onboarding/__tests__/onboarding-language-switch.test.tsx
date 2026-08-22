import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { OnboardingLanguageSwitch } from '../onboarding-language-switch';

describe('OnboardingLanguageSwitch', () => {
  it('shows both language choices and exposes the current selection', () => {
    const html = renderToStaticMarkup(
      <OnboardingLanguageSwitch value="zh" onChange={vi.fn()} />,
    );

    expect(html).toContain('aria-label="Language / 语言"');
    expect(html).toContain('EN');
    expect(html).toContain('中文');
    expect(html).toMatch(/aria-pressed="true"[^>]*>中文<\/button>/);
  });
});

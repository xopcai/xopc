import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { messages } from '@/i18n/messages';

import { AgentStatusBadges } from '../agent-status-badges';

describe('agent status badges', () => {
  it.each(['en', 'zh'] as const)('localizes every badge in %s and supports overlapping defaults', (locale) => {
    const m = messages(locale).agentsSettings;
    const render = (id: string, isDefault = false, tuiDefaultAgentId = 'coder') => renderToStaticMarkup(
      <AgentStatusBadges agent={{ id, isDefault }} tuiDefaultAgentId={tuiDefaultAgentId} messages={m} />,
    );

    expect(render('main', true)).toContain(m.listDefaultBadge);
    expect(render('coder')).toContain(m.tuiDefaultBadge);
    expect(render('coder')).not.toContain(m.listCustomBadge);
    expect(render('personal-a1b2c3d4e5f6')).toContain(m.listPersonalDefaultBadge);
    expect(render('personal-a1b2c3d4e5f6')).not.toContain(m.listCustomBadge);
    expect(render('writer')).toContain(m.listCustomBadge);
    const combined = render('personal-a1b2c3d4e5f6', true, 'personal-a1b2c3d4e5f6');
    expect(combined).toContain(m.listDefaultBadge);
    expect(combined).toContain(m.tuiDefaultBadge);
    expect(combined).toContain(m.listPersonalDefaultBadge);
    expect(combined).not.toContain(m.listCustomBadge);
  });
});

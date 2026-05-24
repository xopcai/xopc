import type { Location } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { isAgentDefaultsNavActive, isAgentDefaultsNavTab } from '@/navigation/agent-defaults-nav';

function loc(pathname: string, search = ''): Location {
  return { pathname, search, hash: '', state: null, key: 'default' } as Location;
}

describe('agent-defaults-nav', () => {
  it('recognizes agent defaults rail tabs', () => {
    expect(isAgentDefaultsNavTab('settingsAgentContext')).toBe(true);
    expect(isAgentDefaultsNavTab('settingsAgentMemory')).toBe(true);
    expect(isAgentDefaultsNavTab('settingsGateway')).toBe(false);
  });

  it('highlights the matching ?tab= slice on agent defaults', () => {
    const base = loc('/settings/agent-defaults');
    expect(isAgentDefaultsNavActive('settingsAgentChat', base)).toBe(true);
    expect(isAgentDefaultsNavActive('settingsAgentContext', loc('/settings/agent-defaults', '?tab=context'))).toBe(
      true,
    );
    expect(isAgentDefaultsNavActive('settingsAgentContext', loc('/settings/agent-defaults', '?tab=memory'))).toBe(
      false,
    );
    expect(isAgentDefaultsNavActive('settingsAgentMemory', loc('/settings/agent-defaults', '?tab=memory'))).toBe(
      true,
    );
  });
});

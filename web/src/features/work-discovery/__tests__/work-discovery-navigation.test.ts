import { describe, expect, it } from 'vitest';

import {
  closeWorkDiscoveryOverlaySearch,
  isWorkDiscoveryOverlaySearch,
  openWorkDiscoveryOverlaySearch,
} from '../work-discovery-navigation';

describe('work discovery overlay navigation', () => {
  it('opens without discarding the current About You view', () => {
    const search = openWorkDiscoveryOverlaySearch('?tab=sources');

    expect(search).toBe('?tab=sources&workDiscovery=new');
    expect(isWorkDiscoveryOverlaySearch(search)).toBe(true);
  });

  it('closes without discarding unrelated search parameters', () => {
    expect(closeWorkDiscoveryOverlaySearch('?tab=privacy&workDiscovery=new')).toBe('?tab=privacy');
  });

  it('returns an empty search string when no other parameters remain', () => {
    expect(closeWorkDiscoveryOverlaySearch('?workDiscovery=new')).toBe('');
  });
});

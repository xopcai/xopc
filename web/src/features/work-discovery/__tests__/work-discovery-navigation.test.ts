import { describe, expect, it, vi } from 'vitest';

import {
  closeWorkDiscoveryOverlaySearch,
  isWorkDiscoveryOverlaySearch,
  openWorkServiceConnection,
  openWorkDiscoveryOverlaySearch,
  WORK_SERVICE_CONNECT_PATH,
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

  it('closes an embedding experience before opening work services', () => {
    const calls: string[] = [];
    const onNavigateAway = vi.fn(() => calls.push('close'));
    const navigate = vi.fn((path: string) => calls.push(`navigate:${path}`));

    openWorkServiceConnection(navigate, onNavigateAway);

    expect(onNavigateAway).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith(WORK_SERVICE_CONNECT_PATH);
    expect(calls).toEqual(['close', `navigate:${WORK_SERVICE_CONNECT_PATH}`]);
  });
});

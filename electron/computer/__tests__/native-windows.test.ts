import { describe, expect, it } from 'vitest';
import { decodeNativeWindowCandidates } from '../native-windows.js';

const window = { window_id: 7, pid: 42, app_name: 'Fixture', title: 'Document',
  bounds: { x: -100, y: 10, width: 800, height: 600 }, is_on_screen: false, on_current_space: false,
  layer: 0, z_index: 3, current_space_id: 5, space_ids: [8] };

describe('optional native input-window discovery', () => {
  it('preserves hidden/off-Space candidates and exact identity without choosing one', () => {
    const result = decodeNativeWindowCandidates({ windows: [window, { ...window, window_id: 8 }] }, 42);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ windowId: 7n, pid: 42, isOnScreen: false, onCurrentSpace: false,
      currentSpaceId: 5n, spaceIds: [8n], bounds: { x: -100 } });
  });
  it('preserves optional logical layout evidence separately from compositor geometry', () => {
    const layout = { ...window.bounds, height: 610 };
    const [candidate] = decodeNativeWindowCandidates({ windows: [{ ...window, layout_bounds: layout }] }, 42);
    expect(candidate.bounds.height).toBe(600);
    expect(candidate.layoutBounds).toEqual(layout);
  });
  it.each([
    { ...window, pid: 43 }, { ...window, window_id: Number.MAX_SAFE_INTEGER + 1 },
    { ...window, bounds: { ...window.bounds, width: 0 } },
  ])('refuses foreign identity or malformed candidate data', candidate => {
    expect(() => decodeNativeWindowCandidates({ windows: [candidate] }, 42)).toThrow('COMPUTER_DRIVER_INVALID_RESULT');
  });
});

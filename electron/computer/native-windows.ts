import type { WindowInfo } from '@trycua/cua-driver';
import { z } from 'zod';

const Integer = z.number().int().safe();
const Bounds = z.object({ x: z.number().finite(), y: z.number().finite(), width: z.number().positive(), height: z.number().positive() });
export type NativeWindowCandidate = WindowInfo & { layoutBounds?: z.infer<typeof Bounds> };
const Window = z.object({ window_id: Integer.positive(), pid: Integer.positive(), app_name: z.string(), title: z.string(),
  bounds: Bounds, layout_bounds: Bounds.nullish(),
  is_on_screen: z.boolean(), on_current_space: z.boolean().nullish(), layer: Integer.nullish(), z_index: Integer.nullish(),
  current_space_id: Integer.positive().nullish(), space_ids: z.array(Integer.positive()).nullish() });

/** The optional fast discovery query never authorizes input or chooses a window. */
export function decodeNativeWindowCandidates(data: unknown, pid: number): NativeWindowCandidate[] {
  const parsed = z.object({ windows: z.array(Window).max(1000) }).safeParse(data);
  if (!parsed.success || parsed.data.windows.some(window => window.pid !== pid)) throw new Error('COMPUTER_DRIVER_INVALID_RESULT');
  return parsed.data.windows.map(window => ({ pid: window.pid, windowId: BigInt(window.window_id), appName: window.app_name,
    title: window.title, bounds: window.bounds, layoutBounds: window.layout_bounds ?? undefined, isOnScreen: window.is_on_screen, onCurrentSpace: window.on_current_space ?? undefined,
    layer: window.layer ?? undefined, zIndex: window.z_index == null ? undefined : BigInt(window.z_index),
    currentSpaceId: window.current_space_id == null ? undefined : BigInt(window.current_space_id),
    spaceIds: window.space_ids?.map(value => BigInt(value)) }));
}

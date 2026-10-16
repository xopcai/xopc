import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => { Object.assign(globalThis,{ ObservedV2: (value: unknown) => value,Trace: () => undefined }); });
import { XopcDiscussionRecordingPanel, recordingPanelAvailability, type XopcRecordingPanelActions } from '../entry/src/main/ets/viewmodel/discussionRecordingPanel.ets';
let panel: XopcDiscussionRecordingPanel;
beforeEach(() => { panel = new XopcDiscussionRecordingPanel(); panel.resize(400,800); });
const controls = (): XopcRecordingPanelActions => ({ phase: 'recording',captureStatus: 'recording',inputConfirmed: true,recoveryBusy: false,mark: vi.fn(async () => {}),togglePause: vi.fn(),stop: vi.fn(async () => 'note') });
describe('recording panel geometry and independent presentation state', () => {
  it('starts inside the screen, moves by cumulative gesture offsets and clamps every edge', () => {
    expect(panel.panelX + panel.cardWidth).toBe(388); expect(panel.panelY + panel.cardHeight).toBe(788);
    panel.dragStart(); panel.dragTo(-10000,-10000); expect([panel.panelX,panel.panelY]).toEqual([12,12]);
    panel.dragTo(10000,10000); expect([panel.panelX,panel.panelY]).toEqual([12,356]);
    panel.dragEnd(); panel.corner(false,false); panel.dragStart(); panel.dragTo(5,10); panel.dragTo(10,20);
    expect([panel.panelX,panel.panelY]).toEqual([12,32]);
  });
  it('cancels safely and ignores stale gesture events after resize or minimization', () => {
    panel.corner(false,false); panel.dragStart(); panel.dragTo(100,100); panel.dragCancel(1000);
    expect([panel.panelX,panel.panelY]).toEqual([12,12]); panel.togglePositions(1100); expect(panel.positionMenu).toBe(false);
    panel.togglePositions(1300); expect(panel.positionMenu).toBe(true);
    panel.dragStart(); panel.resize(700,400); const before = [panel.panelX,panel.panelY]; panel.dragTo(100,100); expect([panel.panelX,panel.panelY]).toEqual(before);
    panel.dragStart(); panel.setCompact(true); const compact = [panel.panelX,panel.panelY]; panel.dragTo(100,100); expect([panel.panelX,panel.panelY]).toEqual(compact);
  });
  it('keeps both expanded and compact controls inside portrait, landscape and keyboard-reduced viewports', () => {
    for (const [width,height] of [[375,812],[840,700],[812,375],[320,568],[375,220],[300,180]]) {
      for (const compact of [false,true]) {
        panel.resize(width!,height!); panel.setCompact(compact); panel.corner(true,true); panel.setNotice(true);
        expect(panel.panelX).toBeGreaterThanOrEqual(12); expect(panel.panelY).toBeGreaterThanOrEqual(12);
        expect(panel.panelX + panel.cardWidth).toBeLessThanOrEqual(width! - 12);
        expect(panel.panelY + panel.cardHeight).toBeLessThanOrEqual(height! - 12);
        panel.togglePositions(10000); expect(panel.panelY + panel.cardHeight).toBeLessThanOrEqual(height! - 12);
      }
    }
  });
  it('can expand in a short window and keeps corner choices reachable while the keyboard reduces height', () => {
    panel.resize(375,220); panel.setCompact(true); expect(panel.small).toBe(true);
    panel.setCompact(false); expect(panel.small).toBe(false); expect(panel.cardHeight).toBe(196);
    panel.togglePositions(10000); expect(panel.positionMenu).toBe(true); expect(panel.cardHeight).toBe(152);
    panel.corner(true,true); expect(panel.positionMenu).toBe(false); expect(panel.panelY + panel.cardHeight).toBe(208);
  });
  it('preserves placement across collapse, expansion and content changes, with a new recording starting expanded', () => {
    panel.resize(1200,900); panel.corner(false,false); panel.setCompact(true); panel.detailsOpen = true; panel.transcriptOpen = true;
    const point = [panel.panelX,panel.panelY]; panel.setNotice(true); panel.setCompact(false); expect([panel.panelX,panel.panelY]).toEqual(point);
    panel.fresh(); expect([panel.compact,panel.detailsOpen,panel.transcriptOpen]).toEqual([false,false,false]);
    panel.resize(NaN,0); expect(panel.windowWidth).toBe(1200);
  });
});
describe('same recording commands in both presentation modes', () => {
  it('routes highlight and pause without changing recording identity, and verifies input before highlighting', async () => {
    const capture = controls();
    for (const compact of [false,true]) { panel.setCompact(compact); await panel.mark(capture); panel.pause(capture); }
    expect(capture.mark).toHaveBeenCalledTimes(2); expect(capture.togglePause).toHaveBeenCalledTimes(2); expect(capture.stop).not.toHaveBeenCalled();
    capture.inputConfirmed = false; capture.captureStatus = 'waiting'; await panel.mark(capture); expect(capture.mark).toHaveBeenCalledTimes(2);
    capture.phase = 'paused'; expect(recordingPanelAvailability(capture)).toEqual({mark:false,pause:true,finish:true});
    capture.phase = 'stopping'; panel.pause(capture); expect(recordingPanelAvailability(capture)).toEqual({mark:false,pause:false,finish:false});
  });
  it('stops once even if presentation changes or Finish is tapped repeatedly while saving', async () => {
    const capture = controls(); let saved!: (id: string) => void;
    capture.stop = vi.fn(() => new Promise(resolve => { saved = resolve; })); const navigate = vi.fn();
    const first = panel.finish(capture,navigate); panel.setCompact(true); const second = panel.finish(capture,navigate);
    await panel.mark(capture); panel.pause(capture); expect(capture.stop).toHaveBeenCalledTimes(1); expect(capture.mark).not.toHaveBeenCalled();
    expect(panel.finishing).toBe(true); capture.phase = 'completed'; saved('same-note'); await Promise.all([first,second]);
    expect(navigate).toHaveBeenCalledExactlyOnceWith('same-note'); expect(panel.finishing).toBe(false);
  });
  it('retains recovery on save/sync failures without resetting the source or navigating to a duplicate note', async () => {
    const capture = controls(); const navigate = vi.fn();
    capture.stop = vi.fn(async () => { capture.phase = 'error'; return 'existing-note'; });
    await panel.finish(capture,navigate); expect(navigate).not.toHaveBeenCalled(); expect(panel.finishing).toBe(false);
    capture.stop = vi.fn(async () => { capture.phase = 'completed'; return 'existing-note'; });
    await panel.finish(capture,navigate); expect(navigate).toHaveBeenCalledExactlyOnceWith('existing-note');
  });
  it('releases the action gate after an unexpected stop failure', async () => {
    const capture = controls(); capture.stop = vi.fn(async () => { throw new Error('disk unavailable'); });
    await expect(panel.finish(capture,vi.fn())).rejects.toThrow('disk unavailable'); expect(panel.finishing).toBe(false);
    expect(recordingPanelAvailability(capture).finish).toBe(true);
  });
});

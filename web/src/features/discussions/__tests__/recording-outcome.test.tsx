// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { projectRecordingOutcome, type XopcRecordingOutcomeInput } from '@xopcai/gateway-contract';
import { RecordingOutcomeCard } from '../recording-outcome-card';

const input = (patch: Partial<XopcRecordingOutcomeInput> = {}): XopcRecordingOutcomeInput => ({
  localSave: 'unknown',sync: 'pending',serverStatus: 'stopping',failureStage: '',jobState: '',retryScheduled: false,
  audioAvailable: false,audioDeleted: false,textAvailable: false,noteAvailable: false,analysisStale: false,...patch,
});
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await act(async () => root.unmount()); document.body.innerHTML = ''; });
async function render(value: XopcRecordingOutcomeInput, options: { compact?: boolean; busy?: boolean } = {}) {
  const container = document.createElement('div');document.body.append(container);const root = createRoot(container);roots.push(root);const retry = vi.fn();
  await act(async () => root.render(<RecordingOutcomeCard input={value} zh onRetry={retry} {...options} />));return { container,retry };
}
describe('recording completion product states', () => {
  it.each([
    [{ localSave: 'failed' },'save_failed','hold','none'],
    [{ localSave: 'saving' },'local_saving','hold','none'],
    [{ localSave: 'saving',audioAvailable: true },'local_saving','hold','none'],
    [{ localSave: 'complete',sync: 'offline' },'sync_failed','local','sync'],
    [{ localSave: 'complete',sync: 'verifying' },'verifying','local','none'],
    [{ localSave: 'partial',sync: 'failed' },'local_partial','hold','recover'],
    [{ jobState: 'failed' },'verify_failed','hold','pipeline'],
    [{ jobState: 'running' },'verifying','hold','none'],
    [{ audioAvailable: true,serverStatus: 'needs_attention',failureStage: 'transcript_sealing' },'transcription_failed','cloud','pipeline'],
    [{ audioAvailable: true,serverStatus: 'needs_attention',failureStage: 'organization' },'analysis_failed','cloud','pipeline'],
    [{ audioAvailable: true,serverStatus: 'organizing',retryScheduled: true },'analysis_retrying','cloud','none'],
    [{ audioAvailable: true,serverStatus: 'sealing',retryScheduled: true },'transcription_retrying','cloud','none'],
    [{ audioAvailable: true,serverStatus: 'completed',noteAvailable: true },'ready','cloud','none'],
    [{ audioAvailable: true,serverStatus: 'completed' },'analysis_missing','cloud','regenerate'],
    [{ audioAvailable: true,serverStatus: 'completed',noteAvailable: true,analysisStale: true },'analysis_stale','cloud','analyze'],
    [{ audioAvailable: true,audioDeleted: true,serverStatus: 'completed' },'audio_deleted','hold','none'],
    [{ serverStatus: 'needs_attention' },'source_missing','hold','none'],
  ] as const)('projects %j into %s', (patch,stage,leave,retry) => {
    expect(projectRecordingOutcome(input(patch))).toMatchObject({ stage,leave,retry });
  });
  it('presents the local barrier and actionable sync retry without claiming audio can already be played', async () => {
    const { container,retry } = await render(input({ localSave: 'complete',sync: 'offline',textAvailable: true }));
    expect(container.textContent).toContain('录音已在本机保存，可以离开当前页面');
    expect(container.textContent).toContain('原音 · 尚未完成');expect(container.textContent).toContain('文字 · 可用');
    await act(async () => container.querySelector('button')!.click());expect(retry).toHaveBeenCalledWith('sync');
  });
  it('keeps previous text and notes usable while the failed note generation resumes in place', async () => {
    const { container,retry } = await render(input({ audioAvailable: true,textAvailable: true,noteAvailable: true,analysisStale: true,serverStatus: 'needs_attention',failureStage: 'organization' }));
    expect(container.textContent).toContain('笔记 · 旧版可用');expect(container.textContent).toContain('不会重新录音或创建重复笔记');
    await act(async () => container.querySelector('button')!.click());expect(retry).toHaveBeenCalledWith('pipeline');
  });
  it('does not offer manual processing retry while an automatic retry is scheduled', async () => {
    const { container } = await render(input({ audioAvailable: true,serverStatus: 'sealing',retryScheduled: true }));
    expect(container.textContent).toContain('系统稍后自动重试');expect(container.querySelector('button')).toBeNull();
  });
  it('retains safe-leave information and disables duplicate retries in compact mode', async () => {
    const { container,retry } = await render(input({ localSave: 'complete',sync: 'failed' }),{ compact: true,busy: true });
    expect(container.textContent).toContain('可以离开当前页面');
    await act(async () => container.querySelector('button')!.click());expect(retry).not.toHaveBeenCalled();
  });
});

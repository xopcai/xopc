// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PersonalProvenanceTail } from '../personal-provenance-tail';
import { normalizeAgentMessages, mergeConsecutiveAssistantMessages } from '../agent-messages';
import { fetchJson } from '@/lib/fetch';
import { useLocaleStore } from '@/stores/locale-store';

vi.mock('@/lib/fetch', () => ({ fetchJson: vi.fn() }));
const provenance = { outreachId: 'a573b3c3-34e5-476b-b993-67b6c542ae48', reasonKind: 'discussion' as const, authority: 'inferred' as const };
const detail = { provenance, thread: { id: 'thread', subject: '产品方向', status: 'active', revision: 1, nextCheckAt: null },
  whyNow: '准备好了新的方案', sourcesAvailable: true,
  sources: [{ conversationId: 'conversation', transcriptId: 'transcript', entryId: 'entry', excerpt: '我们继续讨论这个方向' }] };

describe('Personal provenance tail', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    useLocaleStore.setState({ language: 'zh' });
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
    vi.mocked(fetchJson).mockReset(); vi.mocked(fetchJson).mockResolvedValue({ ok: true, payload: detail });
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); });
  it('shows only a quiet one-line trigger and fetches explanations on click', async () => {
    act(() => root.render(<PersonalProvenanceTail provenance={provenance} />));
    expect(container.textContent).toBe('延续之前的讨论'); expect(fetchJson).not.toHaveBeenCalled();
    await act(async () => container.querySelector('button')!.click());
    expect(document.body.textContent).toContain('为什么现在联系');
    expect(document.body.textContent).toContain('并非明确委托');
    expect(document.body.querySelector('a')?.getAttribute('href')).toContain('entryId=entry');
  });
  it('stops the specific thread without opening a management page', async () => {
    act(() => root.render(<PersonalProvenanceTail provenance={provenance} />));
    await act(async () => container.querySelector('button')!.click());
    const stop = [...document.body.querySelectorAll('button')].find(button => button.textContent === '停止关注')!;
    await act(async () => stop.click());
    const request = vi.mocked(fetchJson).mock.calls.find(([, options]) => options?.method === 'POST');
    expect(request?.[0]).toContain(`${provenance.outreachId}/feedback`);
    expect(JSON.parse(String(request?.[1]?.body))).toMatchObject({ kind: 'stop', scope: 'thread' });
  });
  it('preserves metadata through normalization and does not merge a proactive message with ordinary replies', () => {
    const messages = normalizeAgentMessages([
      { role: 'assistant', content: '普通回复' },
      { role: 'assistant', content: '主动讨论', turnId: `personal-outreach:${provenance.outreachId}`, metadata: { personalProvenance: provenance } },
      { role: 'assistant', content: '后续回复' },
    ]);
    expect(messages[1].personalProvenance).toEqual(provenance);
    expect(mergeConsecutiveAssistantMessages(messages)).toHaveLength(3);
  });
  it('shows strategy history and undoes the latest change from the existing tail panel', async () => {
    const versionId = 'ce0b37a6-6698-420f-9b88-9e69527850d1';
    vi.mocked(fetchJson).mockResolvedValue({ ok: true, payload: { ...detail,
      thread: { ...detail.thread, revision: 2, status: 'completed' },
      strategy: { preparation: 'thorough', versions: [{ id: versionId, revision: 2, kind: 'stop', preparation: 'thorough', createdAt: 1791518400000 }] },
    } });
    act(() => root.render(<PersonalProvenanceTail provenance={provenance} />));
    await act(async () => container.querySelector('button')!.click());
    expect(document.body.textContent).toContain('先准备完整');
    expect(document.body.textContent).toContain('查看调整记录');
    const undo = [...document.body.querySelectorAll('button')].find(button => button.textContent === '撤销最近调整')!;
    await act(async () => undo.click());
    const request = vi.mocked(fetchJson).mock.calls.find(([, options]) => options?.method === 'POST');
    expect(request?.[0]).toContain('/attention/thread/strategy/rollback');
    expect(JSON.parse(String(request?.[1]?.body))).toMatchObject({ versionId, revision: 2 });
  });
});

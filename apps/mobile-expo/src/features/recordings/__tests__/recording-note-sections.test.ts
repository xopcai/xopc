import { createRequire } from 'node:module';
import { createElement, type ReactNode } from 'react';
import { expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ data: null as unknown, isError: false }));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: state.data, isError: state.isError, refetch: vi.fn() }) }));
vi.mock('../../../query/recordings', () => ({ recordingNoteOptions: () => ({}) }));
vi.mock('../../../stores/gateway-store', () => ({ useGatewayStore: () => ({ gatewayId: 'g', deviceId: 'd', gatewayPublicKey: 'key' }) }));
vi.mock('react-native', () => ({
  View: ({ children }: { children: ReactNode }) => createElement('div', null, children),
  ScrollView: ({ children }: { children: ReactNode }) => createElement('div', null, children),
  Image: () => null,
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
}));
vi.mock('react-native-paper', () => ({
  Text: ({ children }: { children: ReactNode }) => createElement('span', null, children),
  Button: ({ children }: { children: ReactNode }) => createElement('button', null, children),
}));
vi.mock('../../../components/ListSkeleton', () => ({ ListSkeleton: () => null }));
vi.mock('../../../theme', async () => {
  const tokens = await import('../../../theme/tokens');
  return { ...tokens, useTheme: () => ({ colors: tokens.colors.light }) };
});
vi.mock('../../../i18n/messages', () => ({ useMessages: () => ({ common: { retry: 'Retry' }, recordings: {
  summary: 'Meeting summary', transcript: 'Transcript', transcriptEmpty: 'Pending text', processing: 'Processing', processingFailed: 'Processing failed', error: 'Load failed',
} }) }));
vi.mock('../../chat/MarkdownView', () => ({ MarkdownView: ({ content }: { content: string }) => createElement('p', null, content) }));
import { RecordingNoteSections } from '../RecordingNoteSections';
import { NoteReadSurface } from '../../notes/NoteReadSurface';
const { renderToStaticMarkup } = createRequire(import.meta.url)('react-dom/server') as { renderToStaticMarkup: (element: ReactNode) => string };

it('shows recording transcript and summary alongside, without replacing personal note text', () => {
  state.data = { discussion: { status: 'completed' }, transcript: { text: 'Recognized audio' }, organization: { organization: {
    summary: 'Meeting result', keyPoints: [], decisions: [], actionItems: [],
  } } };
  const html = renderToStaticMarkup(createElement(NoteReadSurface, {
    title: 'Meeting', markdown: 'My handwritten notes', attachmentSrcMap: {}, untitledLabel: 'Untitled',
    leadingContent: createElement(RecordingNoteSections, { noteId: 'note' }),
  }));
  expect(html).toContain('Recognized audio');
  expect(html).toContain('Meeting result');
  expect(html).toContain('My handwritten notes');
});

it('keeps confirmed text visible when later summarization needs attention', () => {
  state.data = { discussion: { status: 'needs_attention', canonicalTranscript: 'Recovered text' }, transcript: { text: '' } };
  const html = renderToStaticMarkup(createElement(RecordingNoteSections, { noteId: 'note' }));
  expect(html).toContain('Recovered text');
  expect(html).toContain('Processing failed');
});

it('adds no meeting content to an ordinary note', () => {
  state.data = null;
  expect(renderToStaticMarkup(createElement(RecordingNoteSections, { noteId: 'ordinary' }))).toBe('');
});

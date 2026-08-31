import { describe, expect, it } from 'vitest';

import {
  buildComposerDraftSeed,
  newChatAutoSendHref,
  newChatHrefForProject,
  projectIntentForNewChatHandoff,
  searchParamsForComposerHandoff,
} from '@/features/chat/session/composer-handoff-params';

describe('composer handoff params', () => {
  it('combines a skill invocation with a supplied draft', () => {
    expect(buildComposerDraftSeed('build-xopc-local-app', 'Add a monthly view')).toBe(
      '/skill:build-xopc-local-app Add a monthly view',
    );
  });

  it('keeps the draft when the skill id is invalid', () => {
    expect(buildComposerDraftSeed('invalid skill', 'Keep this request')).toBe('Keep this request');
  });

  it('builds a trimmed new-chat handoff that sends immediately', () => {
    expect(newChatAutoSendHref('  Summarize this & suggest next steps  '))
      .toBe('/chat/new?draft=Summarize+this+%26+suggest+next+steps&autoSend=1');
    expect(newChatAutoSendHref('   ')).toBeNull();
    expect(newChatAutoSendHref('  ', 'payload-1'))
      .toBe('/chat/new?autoSend=1&attachmentsHandoff=payload-1');
    expect(newChatAutoSendHref('Start from workbench', undefined, { projectScope: 'none' }))
      .toBe('/chat/new?draft=Start+from+workbench&autoSend=1&projectScope=none');
  });

  it('preserves both params while resolving a new chat route', () => {
    expect(searchParamsForComposerHandoff('?skill=build-xopc-local-app&draft=Add+filters&autoSend=1&agent=coder'))
      .toBe('?skill=build-xopc-local-app&draft=Add+filters&autoSend=1');
  });

  it('preserves the attachment handoff but consumes project scope at session creation', () => {
    expect(
      searchParamsForComposerHandoff('?attachmentHandoff=file-1&projectId=project-1'),
    ).toBe('?attachmentHandoff=file-1');
    expect(projectIntentForNewChatHandoff('?attachmentHandoff=file-1&projectId=project-1'))
      .toEqual({ kind: 'project', projectId: 'project-1' });
    expect(projectIntentForNewChatHandoff('?projectScope=none')).toEqual({ kind: 'none' });
    expect(projectIntentForNewChatHandoff('')).toEqual({ kind: 'remember-last' });
    expect(newChatHrefForProject('project-1')).toBe('/chat/new?projectId=project-1');
    expect(newChatHrefForProject(null)).toBe('/chat/new?projectScope=none');
  });

  it('preserves an immediate-send attachment payload while resolving a new chat route', () => {
    expect(
      searchParamsForComposerHandoff('?attachmentsHandoff=payload-1&autoSend=1&projectId=project-1'),
    ).toBe('?autoSend=1&attachmentsHandoff=payload-1');
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const messageBubble = readFileSync(new URL('../MessageBubble.tsx', import.meta.url), 'utf8');
const attachmentStrip = readFileSync(new URL('../composer-attachment-strip.tsx', import.meta.url), 'utf8');
const workScreen = readFileSync(new URL('../../tasks/TaskListScreen.tsx', import.meta.url), 'utf8');
const automationScreen = readFileSync(new URL('../../automation/SchedulesList.tsx', import.meta.url), 'utf8');
const primaryTabs = readFileSync(new URL('../../../../app/(tabs)/_layout.tsx', import.meta.url), 'utf8');
const quickChatTabBar = readFileSync(new URL('../../navigation/QuickChatTabBar.tsx', import.meta.url), 'utf8');
const chatPage = readFileSync(new URL('../use-chat-page.ts', import.meta.url), 'utf8');

describe('recent Harmony mobile parity', () => {
  it('places user references after primary text and before attachments', () => {
    const userBranch = messageBubble.slice(messageBubble.indexOf('{isUser ? ('), messageBubble.indexOf(') : (', messageBubble.indexOf('{isUser ? (')));
    expect(userBranch.indexOf('{userText ? (')).toBeLessThan(userBranch.indexOf('{message.contextRefs?.length ? ('));
    expect(userBranch.indexOf('{message.contextRefs?.length ? (')).toBeLessThan(userBranch.indexOf('{userAttachments.length ? ('));
  });

  it('renders images as thumbnail-only cards while keeping accessible actions', () => {
    const imageStart = attachmentStrip.indexOf('if (uri) {');
    const imageBranch = attachmentStrip.slice(imageStart, attachmentStrip.indexOf('        return (\n          <View key={att.id} style={[styles.chip', imageStart));
    expect(imageBranch).toContain('styles.imageThumbnail');
    expect(imageBranch).not.toContain('{att.name}</Text>');
    expect(imageBranch).toContain('accessibilityLabel={att.name}');
  });

  it('exposes searchable status filters for work and automations', () => {
    expect(workScreen).toContain('labels.searchPlaceholder');
    expect(workScreen).toContain("filter === 'secondary'");
    expect(workScreen).toContain('labels.archivedFilter');
    expect(automationScreen).toContain("useState<'all' | 'enabled' | 'paused'>");
    expect(automationScreen).toContain('filteredAutomations');
  });

  it('matches the five-tab Harmony information architecture and shares one quick composer', () => {
    for (const route of ['(chat)', 'sessions', 'progress', 'library', 'settings']) {
      expect(primaryTabs).toContain(`name="${route}"`);
    }
    expect(primaryTabs).toContain('<QuickChatTabBar {...props} />');
    expect(quickChatTabBar).toContain('<ChatComposer');
    expect(quickChatTabBar).toContain('autoSend: true');
    expect(quickChatTabBar).toContain('<CapsuleTabBar {...props} embedded />');
    expect(chatPage).toContain('sessionAgentConfigQuery.isPending');
  });
});

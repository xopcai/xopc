export type TabMention = {
  start: number;
  end: number;
  query: string;
};

export type MentionableTab = {
  id: number;
  title: string;
  url: string;
  hostname: string;
  active: boolean;
};

export function findTabMention(value: string, cursor: number): TabMention | undefined {
  const beforeCursor = value.slice(0, cursor);
  const match = /(?:^|\s)@([^\s@]*)$/.exec(beforeCursor);
  if (!match) return undefined;
  const query = match[1] ?? '';
  return { start: cursor - query.length - 1, end: cursor, query };
}

export function removeTabMention(value: string, mention: TabMention): string {
  return `${value.slice(0, mention.start)}${value.slice(mention.end)}`;
}

export function filterMentionableTabs(tabs: MentionableTab[], query: string): MentionableTab[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return tabs
    .filter((tab) => !normalizedQuery || `${tab.title}\n${tab.hostname}\n${tab.url}`.toLocaleLowerCase().includes(normalizedQuery))
    .sort((left, right) => Number(right.active) - Number(left.active))
    .slice(0, 8);
}

export async function listMentionableTabs(query: string): Promise<MentionableTab[]> {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const mentionable = tabs.flatMap((tab): MentionableTab[] => {
    if (tab.id === undefined || !tab.url) return [];
    const url = new URL(tab.url);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return [];
    return [{
      id: tab.id,
      title: tab.title?.trim() || url.hostname,
      url: url.toString(),
      hostname: url.hostname,
      active: tab.active,
    }];
  });
  return filterMentionableTabs(mentionable, query);
}

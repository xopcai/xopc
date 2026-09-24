const LEGACY_CHAT_PREVIEW_IDEA = /^Promoted from chat preview \S+ at revision \S+$/;

export function displayLocalAppIdea(idea: string, appName: string): string {
  return LEGACY_CHAT_PREVIEW_IDEA.test(idea.trim()) ? appName : idea;
}

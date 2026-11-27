const FIELD_KEYS: Record<string, string[]> = {
  title: ['title', 'subject', 'name', 'fullName', 'repository', 'project', 'signalSummary'],
  content: ['content', 'body', 'text', 'snippet', 'description', 'summary', 'language', 'topics', 'highlights', 'patterns'],
  participants: ['from', 'to', 'cc', 'bcc', 'sender', 'author', 'organizer', 'creator', 'attendees', 'participants', 'assignee', 'owners', 'owner', 'collaborators'],
  status: ['status', 'state', 'labels', 'priority', 'cycle', 'eventType', 'recurrence', 'recurringEventId', 'isPullRequest', 'fork'],
  timestamps: ['createdAt', 'updatedAt', 'modifiedAt', 'start', 'end', 'dueDate', 'pushedAt', 'created_at', 'updated_at', 'modified_at'],
  owner_activity: ['user', 'username', 'owner', 'selfResponseStatus', 'roleBreakdown'],
};

/** Restrict source fields before either model processing or searchable chunk persistence. */
export function consentFilteredText(value: string | undefined, allowedFields: Set<string>): string | undefined {
  if (!value) return;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
    const keys = new Set([...allowedFields].flatMap(field => FIELD_KEYS[field] ?? []));
    const selected = Object.entries(parsed).filter(([key]) => keys.has(key));
    return selected.length ? JSON.stringify(Object.fromEntries(selected)) : undefined;
  } catch { return !/^\s*[\[{]/.test(value) && allowedFields.has('content') ? value : undefined; }
}

export const PERSONAL_MAIN_TOOL_IDS = [
  'personal_task', 'personal_attention', 'personal_capability', 'personal_request', 'session_recall',
  'read_media', 'read_file', 'session_search', 'personal_read', 'personal_result',
  'user_context_read', 'knowledge_read',
] as const;

export const PERSONAL_TOOL_DESCRIPTIONS: Readonly<Record<string, string>> = {
  session_recall: 'Find exact facts in this conversation, including compacted history. Cannot access other chats.',
  session_search: 'Search other chats locally for short matching excerpts. No model or network calls.',
  read_media: 'Read uploaded media:// text only for a direct local answer. For specialist processing or artifact creation, submit the URI in the Task brief without pre-reading. Large, binary or image material requires a specialist.',
  read_file: 'Read an explicit workspace file only for a direct local answer. For specialist processing, file creation or script execution, submit the path in the Task brief without pre-reading. Output is bounded; submit to a specialist when requiresSpecialist is true.',
  personal_read: 'Read local notes, projects or automation state with list/get. Bounded output; no network or model calls.',
  user_context_read: 'Read saved user identity, habits, preferences and current state: command=search(query), then get(id). Read-only; not a memory write or a search for project decisions.',
  knowledge_read: 'Read scoped project/workspace facts, decisions and commitments: command=search(query), then get(id). For exact conversation quotes use session_recall or session_search.',
  user_context_search: 'Search saved user identity, preferences, routines and current state.',
  user_context_get: 'Read a user assertion returned by user_context_search.',
  knowledge_search: 'Search local project, workspace and session facts, decisions and commitments.',
  knowledge_get: 'Read a knowledge item returned by knowledge_search.',
};

export const PERSONAL_READ_TOOL_ALIASES: Readonly<Record<string, string>> = {
  user_context_search: 'user_context_read', user_context_get: 'user_context_read',
  knowledge_search: 'knowledge_read', knowledge_get: 'knowledge_read',
};

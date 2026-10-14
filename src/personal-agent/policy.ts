export const PERSONAL_MAIN_TOOL_IDS = [
  'personal_task', 'personal_attention', 'personal_capability', 'personal_request', 'personal_preference', 'session_recall',
  'read_media', 'read_file', 'session_search', 'personal_read',
  'user_context_read', 'knowledge_read',
] as const;

export const PERSONAL_TOOL_DESCRIPTIONS: Readonly<Record<string, string>> = {
  personal_task: 'Submit a complete task brief immediately; the background Task Router selects and starts a specialist. Delegate work, inspect own Tasks, send instructions or answer worker questions. Use an available Agent. Announce intent before discovery; claim success only after confirmation.',
  personal_capability: 'Check supported app connection, account selection and specialist availability locally before connected-app work. A ready result is a preflight, not proof of remote service health.',
  personal_request: 'Submit, inspect or cancel connected-app requests. Submit using the connectorId and agentId returned by personal_capability.',
  personal_attention: 'Save explicit requests to check later and proactively report useful developments. The running Gateway checks while the user is away and posts in this chat. Prefer nextCheckLocal; confirm the returned local time and claim saved only after success. No useful development means silence. Valid commands: follow, list, settings, pause, end, resume, interests, feedback, rollback. interests reads silent candidates. feedback applies explicit topic stop/defer/preparation preferences; rollback explicitly undoes the latest strategy version. Query list for IDs and versions. Requires running Gateway; no action authorization or guaranteed notification.',
  personal_preference: 'Save only explicitly requested lasting response preferences.',
  session_recall: 'Find exact facts in this conversation, including compacted history. Cannot access other chats.',
  session_search: 'Search other chats locally for short matching excerpts. No model or network calls.',
  read_media: 'Read text from an uploaded media:// attachment. Large, binary or image material requires a specialist.',
  read_file: 'Read an explicit workspace file. Output is bounded; delegate when requiresSpecialist is true.',
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

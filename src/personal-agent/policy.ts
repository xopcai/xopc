export const PERSONAL_MAIN_TOOL_IDS = [
  'workbook_read', 'workbook_edit',
  'personal_task', 'personal_attention', 'personal_inbox', 'personal_schedule', 'personal_note', 'personal_self_config', 'session_recall',
  'read_media', 'read_file', 'list_dir', 'web_search', 'web_fetch', 'session_search', 'personal_read', 'personal_result',
  'user_context_read', 'knowledge_read', 'personal_memory', 'video_draft', 'music_generation', 'image_generation',
  'create_share', 'skills_list',
] as const;

export const PERSONAL_TOOL_DESCRIPTIONS: Readonly<Record<string, string>> = {
  session_recall: 'Find exact facts in this conversation, including compacted history. Cannot access other chats.',
  session_search: 'List, search, or read owner chats across agents and projects (supports since/until, agentId, projectId, and reading by conversationId). No model or network calls.',
  list_dir: 'List workspace directory entries quickly to orient before answering a simple question or composing a Task brief.',
  web_search: 'Run a fast web lookup (1-2 calls max) to answer simple factual or live questions directly. Delegate multi-source research, surveys or synthesis to personal_task.',
  web_fetch: 'Read one specific web page directly for a quick answer. Delegate multi-page research, interactive browsing or file generation to personal_task.',
  read_media: 'Read uploaded media:// text for a direct local answer or quick triage. Large, binary or image material requires delegating via personal_task.',
  read_file: 'Read an explicit workspace file (bounded preview) for a direct local answer or quick triage. For heavy processing, file creation or script execution, delegate via personal_task.',
  user_context_read: 'Read saved user identity, habits, preferences and current state: command=search(query), then get(id). Read-only; not a memory write or a search for project decisions.',
  knowledge_read: 'Read scoped project/workspace facts, decisions and commitments: command=search(query), then get(id). For exact conversation quotes use session_recall or session_search.',
  user_context_search: 'Search saved user identity, preferences, routines and current state.',
  user_context_get: 'Read a user assertion returned by user_context_search.',
  knowledge_search: 'Search local project, workspace and session facts, decisions and commitments.',
  knowledge_get: 'Read a knowledge item returned by knowledge_search.',
  skills_list: 'List installed skills (read-only) to answer what skills are available before delegating.',
  create_share: 'Create a shareable link when the user explicitly asks to share a result or page.',
};

export const PERSONAL_READ_TOOL_ALIASES: Readonly<Record<string, string>> = {
  user_context_search: 'user_context_read', user_context_get: 'user_context_read',
  knowledge_search: 'knowledge_read', knowledge_get: 'knowledge_read',
  personal_request: 'personal_task', personal_capability: 'personal_task',
};

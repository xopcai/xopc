/**
 * English message bundle for xopc mobile.
 * Keys mirror a subset of web/src/i18n/locales/en.json, adapted for mobile UX.
 */
export const en = {
  // ── Navigation / screens ────────────────────────────────
  nav: {
    sessions: 'Sessions',
    chat: 'Chat',
    settings: 'Settings',
  },

  // ── Drawer sidebar ──────────────────────────────────────
  drawer: {
    newChat: 'New chat',
    agents: 'Agents',
    skills: 'Skills',
    cron: 'Scheduled tasks',
    channels: 'Channels',
    conversations: 'Conversations',
    chats: 'Chats',
    channelsTab: 'Channels',
    brandDescription: 'Language, theme & font',
  },

  // ── Drawer settings popup menu ──────────────────────────
  drawerMenu: {
    language: 'Language',
    theme: 'Theme',
    themeLight: 'Light',
    themeDark: 'Dark',
    themeSystem: 'Follow system',
    fontSize: 'Chat font size',
    about: 'About',
    helpDocs: 'Help docs',
    openAllSettings: 'Open all settings',
  },

  // ── Sessions screen ─────────────────────────────────────
  sessions: {
    searchPlaceholder: 'Search sessions…',
    empty: 'No sessions yet',
    emptyHint: 'Start a new conversation to begin chatting with your AI assistant.',
    noResults: 'No results',
    noResultsHint: 'No sessions match "{{query}}"',
    messagesCount: '{{count}} messages',
    justNow: 'just now',
    pinned: 'Pinned',
    archived: 'Archived',
    gatewayNotConfigured: 'Gateway not configured',
    gatewayNotConfiguredHint: 'Set your gateway base URL and optional token in Settings to load sessions.',
    openSettings: 'Open Settings',
    unauthorized: 'Unauthorized (401). Check your bearer token.',
  },

  // ── Session actions ─────────────────────────────────────
  sessionActions: {
    rename: 'Rename',
    pin: 'Pin',
    unpin: 'Unpin',
    archive: 'Archive',
    unarchive: 'Unarchive',
    delete: 'Delete',
    sessionPinned: 'Session pinned',
    sessionUnpinned: 'Session unpinned',
    sessionArchived: 'Session archived',
    sessionUnarchived: 'Session unarchived',
    sessionDeleted: 'Session deleted',
    failedToPin: 'Failed to pin session',
    failedToUnpin: 'Failed to unpin session',
    failedToArchive: 'Failed to archive session',
    failedToUnarchive: 'Failed to unarchive session',
    failedToDelete: 'Failed to delete session',
    failedToRename: 'Failed to rename session',
  },

  // ── Rename dialog ───────────────────────────────────────
  renameDialog: {
    title: 'Rename session',
    placeholder: 'Session name',
    cancel: 'Cancel',
    rename: 'Rename',
  },

  // ── Delete dialog ───────────────────────────────────────
  deleteDialog: {
    title: 'Delete session',
    message: 'Are you sure you want to delete "{{name}}"? This action cannot be undone.',
    cancel: 'Cancel',
    delete: 'Delete',
  },

  // ── New session sheet ───────────────────────────────────
  newSession: {
    title: 'New chat',
    selectAgent: 'Select agent',
    defaultSuffix: '(default)',
    creatingHint: 'Creating a new chat session{{agentName}}.',
    cancel: 'Cancel',
    create: 'Create',
  },

  // ── Chat screen ─────────────────────────────────────────
  chat: {
    missingKey: 'Missing session key.',
    inputPlaceholder: 'Type a message…',
    send: 'Send',
    stop: 'Stop',
    thinking: 'Thinking…',
    toolRunning: 'Running…',
    toolDone: 'Done',
    toolError: 'Error',
    resumeBanner: 'An in-flight run may still be active. Tap resume to reattach SSE.',
    resumeButton: 'Resume stream',
    dismiss: 'Dismiss',
    failedToRename: 'Failed to rename',
  },

  // ── Settings screen ─────────────────────────────────────
  settings: {
    title: 'Settings',
    // Gateway section
    gateway: 'Gateway',
    gatewayHint: 'MMKV persists these fields in a development build. Expo Go uses in-memory storage only.',
    baseUrl: 'Base URL',
    baseUrlRequired: 'Base URL is required',
    baseUrlInvalid: 'Must be a valid http(s) URL',
    token: 'Bearer token (optional)',
    thinkingLevel: 'Thinking level (optional)',
    save: 'Save',
    // Appearance section
    appearance: 'Appearance',
    language: 'Language',
    languageEn: 'English',
    languageZh: '中文',
    theme: 'Theme',
    themeLight: 'Light',
    themeDark: 'Dark',
    themeSystem: 'Follow system',
    // Agent section
    agents: 'Agents',
    defaultAgent: 'Default agent',
    agentListEmpty: 'No agents configured on the gateway.',
    agentLoadFailed: 'Failed to load agents.',
    retry: 'Retry',
  },

  // ── Agents page ──────────────────────────────────────────
  agentsPage: {
    title: 'Agents',
    empty: 'No agents configured on the gateway.',
    loadFailed: 'Failed to load agents.',
    defaultBadge: 'Default',
    model: 'Model',
    chatWith: 'Chat',
  },

  // ── Channels page ────────────────────────────────────────
  channelsPage: {
    title: 'Channels',
    empty: 'No channels configured.',
    loadFailed: 'Failed to load channels.',
    enabled: 'Enabled',
    disabled: 'Disabled',
    connected: 'Connected',
    disconnected: 'Disconnected',
  },

  // ── Skills page ─────────────────────────────────────────
  skillsPage: {
    title: 'Skills',
    empty: 'No skills available.',
    loadFailed: 'Failed to load skills.',
    enabled: 'Enabled',
    disabled: 'Disabled',
    sourceBuiltin: 'Built-in',
    sourceWorkspace: 'Workspace',
    sourceGlobal: 'Global',
    sourceExtra: 'Extra',
    managed: 'Managed',
  },

  // ── Common ──────────────────────────────────────────────
  common: {
    ok: 'OK',
    cancel: 'Cancel',
    retry: 'Retry',
    loading: 'Loading…',
    error: 'Error',
  },
};

/** Recursively widen all string literal values to `string` so zh.ts can assign translated values. */
type DeepStringify<T> = {
  [K in keyof T]: T[K] extends string ? string : DeepStringify<T[K]>;
};

export type MessageBundle = DeepStringify<typeof en>;

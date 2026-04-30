/**
 * 中文消息 bundle。
 * 结构与 en.ts 完全一致。
 */
import type { MessageBundle } from './en';

export const zh: MessageBundle = {
  // ── 导航 / 屏幕 ─────────────────────────────────────────
  nav: {
    sessions: '会话',
    chat: '聊天',
    settings: '设置',
  },

  // ── 侧边栏 ─────────────────────────────────────────────
  drawer: {
    newChat: '新建对话',
    agents: '智能体',
    skills: '技能',
    cron: '定时任务',
    channels: '消息通道',
    conversations: '对话',
    chats: '对话',
    channelsTab: '消息通道',
    brandDescription: '语言、主题与字号',
  },

  // ── 侧边栏设置弹出菜单 ─────────────────────────────────
  drawerMenu: {
    language: '语言',
    theme: '主题亮暗',
    themeLight: '浅色',
    themeDark: '深色',
    themeSystem: '跟随系统',
    fontSize: '对话字号',
    about: '关于',
    helpDocs: '帮助文档',
    openAllSettings: '打开全部设置',
  },

  // ── 会话列表 ────────────────────────────────────────────
  sessions: {
    searchPlaceholder: '搜索会话…',
    empty: '暂无会话',
    emptyHint: '开始一段新对话，与你的 AI 助手聊天。',
    noResults: '无结果',
    noResultsHint: '没有匹配 "{{query}}" 的会话',
    messagesCount: '{{count}} 条消息',
    justNow: '刚刚',
    pinned: '已置顶',
    archived: '已归档',
    gatewayNotConfigured: '未配置网关',
    gatewayNotConfiguredHint: '请在设置中填写网关地址和可选的令牌以加载会话。',
    openSettings: '打开设置',
    unauthorized: '未授权 (401)，请检查令牌。',
  },

  // ── 会话操作 ────────────────────────────────────────────
  sessionActions: {
    rename: '重命名',
    pin: '置顶',
    unpin: '取消置顶',
    archive: '归档',
    unarchive: '取消归档',
    delete: '删除',
    sessionPinned: '会话已置顶',
    sessionUnpinned: '已取消置顶',
    sessionArchived: '会话已归档',
    sessionUnarchived: '已取消归档',
    sessionDeleted: '会话已删除',
    failedToPin: '置顶失败',
    failedToUnpin: '取消置顶失败',
    failedToArchive: '归档失败',
    failedToUnarchive: '取消归档失败',
    failedToDelete: '删除失败',
    failedToRename: '重命名失败',
  },

  // ── 重命名对话框 ────────────────────────────────────────
  renameDialog: {
    title: '重命名会话',
    placeholder: '会话名称',
    cancel: '取消',
    rename: '重命名',
  },

  // ── 删除确认 ────────────────────────────────────────────
  deleteDialog: {
    title: '删除会话',
    message: '确定要删除 "{{name}}" 吗？此操作不可撤销。',
    cancel: '取消',
    delete: '删除',
  },

  // ── 新建会话 ────────────────────────────────────────────
  newSession: {
    title: '新建聊天',
    selectAgent: '选择 Agent',
    defaultSuffix: '（默认）',
    creatingHint: '正在创建新的聊天会话{{agentName}}。',
    cancel: '取消',
    create: '创建',
  },

  // ── 聊天界面 ────────────────────────────────────────────
  chat: {
    missingKey: '缺少会话密钥。',
    inputPlaceholder: '输入消息…',
    send: '发送',
    stop: '停止',
    thinking: '思考中…',
    toolRunning: '运行中…',
    toolDone: '完成',
    toolError: '出错',
    resumeBanner: '可能有正在进行的请求。点击恢复以重新连接 SSE。',
    resumeButton: '恢复流',
    dismiss: '关闭',
    failedToRename: '重命名失败',
  },

  // ── 设置界面 ────────────────────────────────────────────
  settings: {
    title: '设置',
    // 网关
    gateway: '网关',
    gatewayHint: '开发构建中通过 MMKV 持久化存储。Expo Go 仅使用内存存储。',
    baseUrl: '网关地址',
    baseUrlRequired: '网关地址不能为空',
    baseUrlInvalid: '必须是有效的 http(s) 链接',
    token: 'Bearer 令牌（可选）',
    thinkingLevel: '思考级别（可选）',
    save: '保存',
    // 外观
    appearance: '外观',
    language: '语言',
    languageEn: 'English',
    languageZh: '中文',
    theme: '主题',
    themeLight: '浅色',
    themeDark: '深色',
    themeSystem: '跟随系统',
    // Agent
    agents: 'Agents',
    defaultAgent: '默认 Agent',
    agentListEmpty: '网关上未配置任何 Agent。',
    agentLoadFailed: '加载 Agent 失败。',
    retry: '重试',
  },

  // ── Agents 页面 ────────────────────────────────────────
  agentsPage: {
    title: '智能体',
    empty: '网关上未配置任何智能体。',
    loadFailed: '加载智能体失败。',
    defaultBadge: '默认',
    model: '模型',
    chatWith: '对话',
  },

  // ── Channels 页面 ─────────────────────────────────────────
  channelsPage: {
    title: '消息通道',
    empty: '未配置任何消息通道。',
    loadFailed: '加载消息通道失败。',
    enabled: '已启用',
    disabled: '已禁用',
    connected: '已连接',
    disconnected: '未连接',
  },

  // ── Skills 页面 ──────────────────────────────────────────
  skillsPage: {
    title: '技能',
    empty: '暂无可用技能。',
    loadFailed: '加载技能失败。',
    enabled: '已启用',
    disabled: '已禁用',
    sourceBuiltin: '内置',
    sourceWorkspace: '工作区',
    sourceGlobal: '全局',
    sourceExtra: '扩展',
    managed: '托管',
  },

  // ── 通用 ────────────────────────────────────────────────
  common: {
    ok: '好',
    cancel: '取消',
    retry: '重试',
    loading: '加载中…',
    error: '错误',
  },
} as const;

import { EXTERNAL_TOOL_NAMES } from '../agent/external-tools/index.js';

export type GatewayBuiltinToolSummary = {
  id: string;
  description: { en: string; zh: string };
};

/** Built-in agent tools exposed by the gateway configuration UI. */
export const GATEWAY_BUILTIN_TOOLS = [
  { id: 'read_file', description: { en: 'Read file contents from the workspace.', zh: '读取工作区中的文件内容。' } },
  { id: 'write_file', description: { en: 'Create or replace a file in the workspace.', zh: '在工作区中创建或覆盖文件。' } },
  { id: 'apply_patch', description: { en: 'Apply precise, reviewable changes to workspace files.', zh: '对工作区文件应用精确且便于审查的修改。' } },
  { id: 'list_dir', description: { en: 'List files and folders in a directory.', zh: '列出目录中的文件和文件夹。' } },
  { id: 'grep', description: { en: 'Search file contents for text or patterns.', zh: '在文件内容中搜索文本或模式。' } },
  { id: 'find', description: { en: 'Find files and folders by name or path.', zh: '按名称或路径查找文件和文件夹。' } },
  { id: 'exec_command', description: { en: 'Run shell commands in the workspace.', zh: '在工作区中运行终端命令。' } },
  { id: 'update_plan', description: { en: 'Create and update the progress plan for a task.', zh: '创建并更新任务的执行计划。' } },
  { id: 'session_status', description: { en: 'Inspect the current session status and usage.', zh: '查看当前会话状态和用量。' } },
  { id: 'dreaming', description: { en: 'Run configured background reflection and consolidation.', zh: '运行已配置的后台反思与信息整理。' } },
  { id: 'tool_manual', description: { en: 'Open detailed usage guidance for supported tools.', zh: '查看受支持工具的详细使用说明。' } },
  { id: 'clarify', description: { en: 'Ask the user a structured clarification question.', zh: '向用户提出结构化的澄清问题。' } },
  { id: 'todo', description: { en: 'Manage the task checklist for the current session.', zh: '管理当前会话的任务清单。' } },
  { id: 'skills_list', description: { en: 'List skills available to the current agent.', zh: '列出当前 Agent 可使用的技能。' } },
  { id: 'skill_view', description: { en: 'Read the instructions for a selected skill.', zh: '读取指定技能的使用说明。' } },
  { id: 'skill_manage', description: { en: 'Create, update, or remove managed skills.', zh: '创建、更新或移除托管技能。' } },
  { id: 'skills_marketplace_search', description: { en: 'Search the skills marketplace.', zh: '搜索技能市场中的可用技能。' } },
  { id: 'skill_install', description: { en: 'Install a skill from an approved source.', zh: '从受支持的来源安装技能。' } },
  { id: 'web_search', description: { en: 'Search the web for current information.', zh: '搜索互联网中的最新信息。' } },
  { id: 'web_fetch', description: { en: 'Fetch readable content from a web address.', zh: '获取网页地址中的可读内容。' } },
  { id: 'web_extract', description: { en: 'Extract structured information from web pages.', zh: '从网页中提取结构化信息。' } },
  { id: 'send_message', description: { en: 'Send a message through the current channel.', zh: '通过当前渠道发送消息。' } },
  { id: 'send_media', description: { en: 'Send an image, audio, video, or file.', zh: '发送图片、音频、视频或文件。' } },
  { id: 'read_media', description: { en: 'Inspect attached images, audio, video, or files.', zh: '读取和分析附加的图片、音频、视频或文件。' } },
  { id: 'create_share', description: { en: 'Create a shareable link for supported content.', zh: '为受支持的内容创建分享链接。' } },
  { id: 'text_to_speech', description: { en: 'Convert text into spoken audio.', zh: '将文本转换为语音音频。' } },
  { id: 'memory_search', description: { en: 'Search long-term memory for relevant context.', zh: '在长期记忆中搜索相关上下文。' } },
  { id: 'memory_get', description: { en: 'Read a specific item from long-term memory.', zh: '读取一条指定的长期记忆。' } },
  { id: 'session_search', description: { en: 'Search previous conversation sessions.', zh: '搜索过去的对话会话。' } },
  { id: 'automation', description: { en: 'Create and manage scheduled or recurring automations.', zh: '创建和管理定时或重复执行的自动化。' } },
  { id: 'workflow', description: { en: 'Start and interact with configured workflows.', zh: '启动并操作已配置的工作流。' } },
  { id: 'delegate_task', description: { en: 'Delegate a focused subtask to another agent.', zh: '将明确的子任务委派给其他 Agent。' } },
  { id: 'execute_code', description: { en: 'Run code in a managed execution environment.', zh: '在托管的运行环境中执行代码。' } },
  { id: 'image', description: { en: 'Analyze images with a vision-capable model.', zh: '使用视觉模型分析图片。' } },
  { id: 'image_generate', description: { en: 'Generate or edit images from instructions.', zh: '根据指令生成或编辑图片。' } },
  { id: 'create_desktop_pet', description: { en: 'Create and install a custom desktop pet.', zh: '创建并安装自定义桌面宠物。' } },
  { id: 'browser_use', description: { en: 'Navigate and interact with websites in a browser.', zh: '在浏览器中访问并操作网站。' } },
  { id: EXTERNAL_TOOL_NAMES.search, description: { en: 'Search connected apps, MCP servers, and extension tools.', zh: '搜索连接器、MCP 服务和扩展提供的工具。' } },
  { id: EXTERNAL_TOOL_NAMES.describe, description: { en: 'Load the exact contract for an external tool.', zh: '读取外部工具的完整调用约定。' } },
  { id: EXTERNAL_TOOL_NAMES.execute, description: { en: 'Execute a selected external tool with validated input.', zh: '使用已验证的参数执行选定的外部工具。' } },
] as const satisfies readonly GatewayBuiltinToolSummary[];

export const GATEWAY_BUILTIN_TOOL_IDS = GATEWAY_BUILTIN_TOOLS.map(({ id }) => id);

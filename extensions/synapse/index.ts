/**
 * Synapse Extension — 人 × AI Agent 协作看板
 *
 * Phase 1: UI + demo mode
 * Phase 2: Tool 注册 → Agent 可操作看板 (current)
 */

import type { ExtensionApi } from 'xopc/extension-sdk';
import {
  createCard, moveCard, updateProgress,
  addDecision, resolveDecision, getBoard,
} from './src/state.js';

export default function register(api: ExtensionApi) {
  api.logger.info('Synapse extension registered (Phase 2)');

  const demoMode = api.extensionConfig.demoMode !== false;
  const autoAdvance = api.extensionConfig.autoAdvance !== false;
  api.logger.info({ demoMode, autoAdvance }, 'Synapse config loaded');

  /* ═══════════════════════════════════════
     Tool 1: synapse_get_board
     获取完整看板状态
     ═══════════════════════════════════════ */
  api.registerTool({
    name: 'synapse_get_board',
    description: '获取 Synapse 看板的完整状态，包括所有卡片、决策项、活动记录和 Agent 状态',
    parameters: {
      type: 'object',
      properties: {},
    },
    async execute(_toolCallId) {
      const board = getBoard();
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            summary: `${board.cards.length} 张卡片，${board.decisions.length} 项待决策`,
            cards: board.cards.map(c => ({
              id: c.i, title: c.t, column: ['待办','进行中','审查中','已完成'][c.c],
              priority: c.l, progress: c.pr, agents: c.ag.map(a => a.name),
            })),
            decisions: board.decisions.map(d => ({ id: d.i, title: d.t, level: d.l })),
          }, null, 2),
        }],
        details: { board },
      };
    },
  });

  /* ═══════════════════════════════════════
     Tool 2: synapse_create_card
     在看板上创建新卡片
     ═══════════════════════════════════════ */
  api.registerTool({
    name: 'synapse_create_card',
    description: '在 Synapse 看板上创建新任务卡片。用于将拆解后的子任务添加到看板。',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '任务标题（简洁明了）' },
        description: { type: 'string', description: '任务详细描述' },
        priority: {
          type: 'string',
          enum: ['p0', 'p1', 'p2'],
          description: '优先级：p0=阻塞紧急，p1=重要，p2=常规',
        },
        column: {
          type: 'number',
          description: '目标列：0=待办，1=进行中，2=审查中，3=已完成。默认 0（待办）',
          default: 0,
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: '标签列表，如 ["后端", "API"]',
        },
        agents: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              icon: { type: 'string', description: 'Agent 图标 emoji，如 🖥' },
              name: { type: 'string', description: 'Agent 标识名，如 dev-backend' },
            },
          },
          description: '分配到该任务的 Agent 列表',
        },
      },
      required: ['title', 'description', 'priority'],
    },
    async execute(_toolCallId, params) {
      const p = params as any;
      const card = createCard({
        title: p.title,
        description: p.description,
        priority: p.priority,
        column: p.column,
        tags: p.tags,
        agents: p.agents,
      });
      return {
        content: [{ type: 'text', text: `✅ 卡片「${card.t}」已创建（#${card.i}，${card.l.toUpperCase()}，${['待办','进行中','审查中','已完成'][card.c]}）` }],
        details: { cardId: card.i, title: card.t },
      };
    },
  });

  /* ═══════════════════════════════════════
     Tool 3: synapse_move_card
     移动卡片到指定列
     ═══════════════════════════════════════ */
  api.registerTool({
    name: 'synapse_move_card',
    description: '将看板卡片移动到指定列。用于任务完成、审查退回等状态流转。',
    parameters: {
      type: 'object',
      properties: {
        cardId: { type: 'number', description: '要移动的卡片 ID' },
        toColumn: {
          type: 'number',
          description: '目标列：0=待办，1=进行中，2=审查中，3=已完成',
        },
      },
      required: ['cardId', 'toColumn'],
    },
    async execute(_toolCallId, params) {
      const p = params as any;
      const card = moveCard({ cardId: p.cardId, toColumn: p.toColumn });
      if (!card) {
        return { content: [{ type: 'text', text: `❌ 未找到卡片 #${p.cardId}` }], isError: true };
      }
      return {
        content: [{ type: 'text', text: `✅ 卡片「${card.t}」已移至 ${['待办','进行中','审查中','已完成'][card.c]}` }],
        details: { cardId: card.i, column: card.c },
      };
    },
  });

  /* ═══════════════════════════════════════
     Tool 4: synapse_update_progress
     更新卡片进度
     ═══════════════════════════════════════ */
  api.registerTool({
    name: 'synapse_update_progress',
    description: '更新看板卡片的执行进度。用于在执行任务过程中实时上报进度。',
    parameters: {
      type: 'object',
      properties: {
        cardId: { type: 'number', description: '要更新的卡片 ID' },
        progress: {
          type: 'number',
          description: '进度百分比（0-100）',
          minimum: 0,
          maximum: 100,
        },
      },
      required: ['cardId', 'progress'],
    },
    async execute(_toolCallId, params) {
      const p = params as any;
      const card = updateProgress({ cardId: p.cardId, progress: p.progress });
      if (!card) {
        return { content: [{ type: 'text', text: `❌ 未找到卡片 #${p.cardId}` }], isError: true };
      }
      return {
        content: [{ type: 'text', text: `✅ 卡片「${card.t}」进度更新为 ${card.pr}%` }],
        details: { cardId: card.i, progress: card.pr },
      };
    },
  });

  /* ═══════════════════════════════════════
     Tool 5: synapse_add_decision
     创建需要人类决策的事项
     ═══════════════════════════════════════ */
  api.registerTool({
    name: 'synapse_add_decision',
    description: '在看板上创建需要人类决策的事项。当 Agent 遇到边界问题、歧义或需要拍板时使用。',
    parameters: {
      type: 'object',
      properties: {
        level: {
          type: 'string',
          enum: ['p0', 'p1'],
          description: '决策优先级：p0=阻塞性，p1=常规',
        },
        title: { type: 'string', description: '决策标题' },
        context: { type: 'string', description: '决策的上下文说明（Agent 遇到的具体问题）' },
        options: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string', description: '选项文本' },
              recommended: { type: 'boolean', description: '是否为推荐选项' },
              confirmMessage: { type: 'string', description: '选择后的确认消息' },
            },
          },
          description: '决策选项列表（建议 2 个）',
        },
      },
      required: ['level', 'title', 'context', 'options'],
    },
    async execute(_toolCallId, params) {
      const p = params as any;
      const dec = addDecision({
        level: p.level,
        title: p.title,
        context: p.context,
        options: (p.options || []).map((o: any) => ({
          label: o.label,
          recommended: o.recommended ?? false,
          confirmMessage: o.confirmMessage ?? o.label,
        })),
      });
      return {
        content: [{ type: 'text', text: `⚠️ 决策「${dec.t}」已创建（${dec.l.toUpperCase()}）——等待人类确认` }],
        details: { decisionId: dec.i, title: dec.t },
      };
    },
  });

  /* ═══════════════════════════════════════
     Tool 6: synapse_resolve_decision
     处理决策（此 Tool 由人类通过 UI 间接调用，
     Agent 不直接调用，但可用于通知 Agent 决策结果）
     ═══════════════════════════════════════ */
  api.registerTool({
    name: 'synapse_resolve_decision',
    description: '查看或处理决策项的结果。Agent 可以通过此工具了解人类的决策结果。',
    parameters: {
      type: 'object',
      properties: {
        decisionId: { type: 'number', description: '要查询/处理的决策 ID' },
      },
      required: ['decisionId'],
    },
    async execute(_toolCallId, params) {
      const board = getBoard();
      const dec = board.decisions.find((d: { i: number }) => d.i === (params as any).decisionId);
      if (!dec) {
        return { content: [{ type: 'text', text: '该决策可能已被处理或不存在' }] };
      }
      return {
        content: [{ type: 'text', text: `决策「${dec.t}」仍在等待处理。选项：${dec.b.map((o: any) => o.l).join(' / ')}` }],
        details: dec,
      };
    },
  });

  /* ═══════════════════════════════════════
     Command
     ═══════════════════════════════════════ */
  api.registerCommand({
    name: 'synapse:open-panel',
    description: '打开 Synapse 看板面板',
    handler: async () => ({ content: 'Synapse 看板已打开（请在 Console 中查看）', success: true }),
  });

  api.registerCommand({
    name: 'synapse:board-status',
    description: '查看 Synapse 看板当前状态摘要',
    handler: async () => {
      const board = getBoard();
      const cols = [0, 1, 2, 3].map(c => board.cards.filter(ca => ca.c === c).length);
      return {
        content: `📊 Synapse 看板状态：
  待办 ${cols[0]} | 进行中 ${cols[1]} | 审查中 ${cols[2]} | 已完成 ${cols[3]}
  ⚠️ ${board.decisions.length} 项待决策`,
        success: true,
      };
    },
  });

  /* ═══════════════════════════════════════
     Hooks
     ═══════════════════════════════════════ */
  api.registerHook('tool_execution_start', (event) => {
    const e = event as any;
    if (e.toolName?.startsWith('synapse_')) {
      api.logger.info({ tool: e.toolName }, 'Synapse tool executing');
    }
  });

  api.registerHook('tool_execution_end', (event) => {
    const e = event as any;
    if (e.toolName?.startsWith('synapse_')) {
      api.logger.info({ tool: e.toolName, durationMs: e.durationMs }, 'Synapse tool completed');
    }
  });

  api.logger.info('Synapse extension ready (Phase 2 — 6 tools registered)');
}

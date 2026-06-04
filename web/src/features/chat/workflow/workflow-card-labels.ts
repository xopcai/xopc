/**
 * Default English label bag for the WorkflowCard tree.
 *
 * Kept in a separate file so callers can either consume it as-is (today's
 * call sites that don't thread i18n yet) or override individual fields once
 * they wire `messages(language).chat.workflow.*` through.
 */

import type { StoredLanguage } from '@/lib/storage';

import type { WorkflowCardLabels } from './workflow-card';
import type { WorkflowAgentDetailDrawerLabels } from './workflow-agent-detail-drawer';

/**
 * Resolve a {@link WorkflowCardLabels} bag for the given language. Falls back
 * to English when an unknown locale is passed.
 *
 * Lives in this module rather than in the global chat.json so all workflow
 * copy stays self-contained — easier to add fields when the card evolves
 * without poking the ~500-line chat translation file.
 */
export function workflowCardLabels(language: StoredLanguage | undefined): WorkflowCardLabels {
  if (language === 'zh') return zhLabels();
  return enLabels();
}

/** @deprecated Use {@link workflowCardLabels}; kept for callers that don't have a language handy. */
export function defaultWorkflowCardLabels(): WorkflowCardLabels {
  return enLabels();
}

function drawerLabelsEn(): WorkflowAgentDetailDrawerLabels {
  return {
    close: 'Close',
    statusQueued: 'Queued',
    statusRunning: 'Running',
    statusDone: 'Completed',
    statusError: 'Failed',
    statusSkipped: 'Skipped',
    workedFor: (d) => `Worked for ${d}`,
    phaseHeading: 'Phase',
    promptHeading: 'Prompt',
    stepsHeading: 'Steps',
    outputHeading: 'Output',
    logsHeading: 'Workflow logs',
    pin: 'Pin',
    pinned: 'Pinned',
    runningPlaceholder: 'Waiting for subagent steps…',
    stream: {
      heading: 'Live output',
      empty: 'No streamed output yet',
    },
  };
}

function drawerLabelsZh(): WorkflowAgentDetailDrawerLabels {
  return {
    close: '关闭',
    statusQueued: '排队中',
    statusRunning: '运行中',
    statusDone: '已完成',
    statusError: '失败',
    statusSkipped: '已跳过',
    workedFor: (d) => `已运行 ${d}`,
    phaseHeading: '阶段',
    promptHeading: 'Prompt',
    stepsHeading: '步骤',
    outputHeading: '输出',
    logsHeading: '工作流日志',
    pin: '固定',
    pinned: '已固定',
    runningPlaceholder: '等待子 agent 步骤…',
    stream: {
      heading: '实时输出',
      empty: '暂无流式输出',
    },
  };
}

function enLabels(): WorkflowCardLabels {
  return {
    header: {
      collapse: 'Collapse',
      expand: 'Expand',
      runningMeta: (count, duration) =>
        duration ? `${count} · ${duration}` : `${count}`,
      completedMeta: (count, duration) =>
        duration ? `✓ ${count} · ${duration}` : `✓ ${count}`,
      failedMeta: 'failed',
    },
    phase: {
      countTpl: (done, total) => `${done}/${total}`,
      runningTag: (n) => `· ${n} running`,
      errorsTag: (n) => `· ${n} errors`,
      skippedTag: (n) => `· ${n} skipped`,
      showPrompt: 'Show prompt',
      hidePrompt: 'Hide prompt',
      promptHeading: 'Prompt',
      resultPreviewHeading: 'Result',
      errorHeading: 'Error',
      emptyPreview: '(no preview)',
      agentNumber: (n) => `#${n}`,
      queued: 'Queued',
      running: 'Running…',
      openDetail: 'View agent details',
    },
    drawer: drawerLabelsEn(),
    result: {
      topFindingsHeading: (n) => `Top findings (${n})`,
      topRisksHeading: (n) => `Top risks (${n})`,
      executiveSummaryHeading: 'Executive summary',
      summaryHeading: 'Summary',
      openQuestionsHeading: 'Open questions',
      moreSuffix: (n) => `${n} more…`,
      rawHeading: 'View raw result',
      emptyResult: '(no result)',
    },
    error: {
      titleParse: 'Workflow parse error',
      titleAbort: 'Workflow aborted',
      titleTimeout: 'Workflow timed out',
      titleRuntime: 'Workflow failed',
      expand: 'Expand details',
      collapse: 'Collapse details',
      expandHint: 'Click to see error details',
      detailsHeading: 'Error',
      logsHeading: 'Workflow logs',
      failedAgentsHeading: 'Failed subagents',
      progressHeading: 'Progress at failure',
      scriptHeading: 'Submitted script',
      noExtraDetails: 'No additional details recorded.',
      phase: {
        countTpl: (done, total) => `${done}/${total}`,
        runningTag: (n) => `· ${n} running`,
        errorsTag: (n) => `· ${n} errors`,
        skippedTag: (n) => `· ${n} skipped`,
        showPrompt: 'Show prompt',
        hidePrompt: 'Hide prompt',
        promptHeading: 'Prompt',
        resultPreviewHeading: 'Result',
        errorHeading: 'Error',
        emptyPreview: '(no preview)',
        agentNumber: (n) => `#${n}`,
        queued: 'Queued',
        running: 'Running…',
        openDetail: 'View agent details',
      },
    },
    cancel: 'Cancel workflow',
    saveAria: 'Save workflow…',
    saveTitle: 'Save this workflow under a name (~/.xopc/workflows/)',
    savePlaceholder: 'snake_case_name',
    saveSubmit: 'Save',
    saveCancel: 'Cancel',
    saveDispatched: 'Saved',
    copyAria: 'Copy result',
    copyDoneAria: 'Copied',
    moreAria: 'More actions',
    viewSubagentsHeading: 'View subagents',
    recentLogsHeading: 'Logs',
    showAllLogs: 'Show all',
  };
}

function zhLabels(): WorkflowCardLabels {
  return {
    header: {
      collapse: '收起',
      expand: '展开',
      runningMeta: (count, duration) => (duration ? `${count} · ${duration}` : `${count}`),
      completedMeta: (count, duration) => (duration ? `✓ ${count} · ${duration}` : `✓ ${count}`),
      failedMeta: '失败',
    },
    phase: {
      countTpl: (done, total) => `${done}/${total}`,
      runningTag: (n) => `· ${n} 运行中`,
      errorsTag: (n) => `· ${n} 失败`,
      skippedTag: (n) => `· ${n} 已跳过`,
      showPrompt: '查看 prompt',
      hidePrompt: '收起 prompt',
      promptHeading: 'Prompt',
      resultPreviewHeading: '结果预览',
      errorHeading: '错误',
      emptyPreview: '（暂无预览）',
      agentNumber: (n) => `#${n}`,
      queued: '排队中',
      running: '运行中…',
      openDetail: '查看 agent 详情',
    },
    drawer: drawerLabelsZh(),
    result: {
      topFindingsHeading: (n) => `主要发现（${n}）`,
      topRisksHeading: (n) => `主要风险（${n}）`,
      executiveSummaryHeading: '摘要',
      summaryHeading: '总结',
      openQuestionsHeading: '待解决的问题',
      moreSuffix: (n) => `还有 ${n} 条…`,
      rawHeading: '查看原始结果',
      emptyResult: '（无结果）',
    },
    error: {
      titleParse: '工作流解析失败',
      titleAbort: '工作流已中止',
      titleTimeout: '工作流超时',
      titleRuntime: '工作流执行失败',
      expand: '展开详情',
      collapse: '收起详情',
      expandHint: '点击查看错误详情',
      detailsHeading: '错误信息',
      logsHeading: '工作流日志',
      failedAgentsHeading: '失败的子 agent',
      progressHeading: '失败时的进度',
      scriptHeading: '提交的脚本',
      noExtraDetails: '没有更多诊断信息。',
      phase: {
        countTpl: (done, total) => `${done}/${total}`,
        runningTag: (n) => `· ${n} 运行中`,
        errorsTag: (n) => `· ${n} 失败`,
        skippedTag: (n) => `· ${n} 已跳过`,
        showPrompt: '查看 prompt',
        hidePrompt: '收起 prompt',
        promptHeading: 'Prompt',
        resultPreviewHeading: '结果预览',
        errorHeading: '错误',
        emptyPreview: '（暂无预览）',
        agentNumber: (n) => `#${n}`,
        queued: '排队中',
        running: '运行中…',
        openDetail: '查看 agent 详情',
      },
    },
    cancel: '取消工作流',
    saveAria: '保存工作流…',
    saveTitle: '把这个工作流保存到 ~/.xopc/workflows/',
    savePlaceholder: 'snake_case 名字',
    saveSubmit: '保存',
    saveCancel: '取消',
    saveDispatched: '已保存',
    copyAria: '复制结果',
    copyDoneAria: '已复制',
    moreAria: '更多操作',
    viewSubagentsHeading: '查看子 agent',
    recentLogsHeading: '日志',
    showAllLogs: '显示全部',
  };
}

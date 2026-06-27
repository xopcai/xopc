/**
 * Default English label bag for the WorkflowCard tree.
 *
 * Kept in a separate file so callers can either consume it as-is (today's
 * call sites that don't thread i18n yet) or override individual fields once
 * they wire `messages(language).chat.workflow.*` through.
 */

import type { StoredLanguage } from '@/lib/storage';

import type { WorkflowCardLabels } from './workflow-card';
import type { WorkflowAgentDetailModalLabels } from './workflow-agent-detail-modal';

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

function drawerLabelsEn(): WorkflowAgentDetailModalLabels {
  return {
    close: 'Close',
    statusQueued: 'Queued',
    statusRunning: 'Running',
    statusDone: 'Completed',
    statusError: 'Failed',
    statusSkipped: 'Skipped',
    workedFor: (d) => `Worked for ${d}`,
    statusHeading: 'Status',
    phaseHeading: 'Phase',
    elapsedHeading: 'Elapsed',
    currentStepHeading: 'Current step',
    executionHeading: 'Execution process',
    outputHeading: 'Output',
    stepsHeading: 'Steps',
    transcriptHeading: 'Transcript',
    promptHeading: 'Prompt',
    logsHeading: 'Workflow logs',
    runningPlaceholder: 'Waiting for subagent steps…',
  };
}

function drawerLabelsZh(): WorkflowAgentDetailModalLabels {
  return {
    close: '关闭',
    statusQueued: '排队中',
    statusRunning: '运行中',
    statusDone: '已完成',
    statusError: '失败',
    statusSkipped: '已跳过',
    workedFor: (d) => `已运行 ${d}`,
    statusHeading: '状态',
    phaseHeading: '阶段',
    elapsedHeading: '耗时',
    currentStepHeading: '当前步骤',
    executionHeading: '执行过程',
    outputHeading: '产出',
    stepsHeading: '步骤',
    transcriptHeading: 'Transcript',
    promptHeading: '输入',
    logsHeading: '工作流日志',
    runningPlaceholder: '等待子 agent 步骤…',
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
      conclusionHeading: 'Conclusion',
      recommendationsHeading: 'Recommendations',
      nextStepsHeading: 'Next steps',
      checklistHeading: 'Checklist',
      moreSuffix: (n) => `${n} more…`,
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
      detailsHeading: 'Failure reason',
      impactHeading: 'Impact',
      recoveryHeading: 'Recommended actions',
      recoveryActions: {
        parse_error: ['Check the workflow script syntax.', 'Make sure workflow fields use the expected snake_case shape.'],
        aborted: ['The run was stopped. Start it again if you still need the result.'],
        timeout: ['Retry the workflow.', 'If it times out again, reduce concurrency or check model/API availability.'],
        runtime_error: ['Review the failed agent first.', 'Use the completed agent results if they are still relevant.', 'Copy the error details if you want to continue diagnosis.'],
      },
      logsHeading: 'Technical logs',
      failedAgentsHeading: 'Agent execution status',
      executedAgentsHeading: 'Agent execution status',
      progressHeading: 'Execution process',
      scriptHeading: 'Submitted script',
      noExtraDetails: 'No additional details recorded.',
      copyReason: 'Copy',
      copyReasonDone: 'Copied',
      impactTpl: (done, total, failed) => `${done}/${total} agents completed · ${failed} need attention`,
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
    saveAria: 'Copy and edit workflow…',
    saveTitle: 'Open a copied workflow draft in the Workflows center',
    savePlaceholder: 'snake_case_name',
    saveSubmit: 'Save',
    saveCancel: 'Cancel',
    saveDispatched: 'Saved',
    copyAria: 'Copy result',
    copyDoneAria: 'Copied',
    moreAria: 'More actions',
    openInWorkflowsAria: 'Open in Workflows',
    openInWorkflowsTitle: 'Open this workflow in the Workflows center',
    viewSubagentsHeading: 'View agents',
    runningProgressHeading: 'Current progress',
    runningAgentsHeading: 'Running agents',
    completedAgentsHeading: 'Completed agents',
    queuedAgentsHeading: 'Queued agents',
    failedAgentsHeading: 'Needs attention',
    currentProgressTpl: (phase, running, done, total) => {
      const phaseText = phase ? `Phase: ${phase}` : 'Workflow is running';
      return `${phaseText} · ${running} running · ${done}/${total} completed`;
    },
    recentLogsHeading: 'Recent updates',
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
      conclusionHeading: '结论',
      recommendationsHeading: '处理建议',
      nextStepsHeading: '建议下一步',
      checklistHeading: '检查清单',
      moreSuffix: (n) => `还有 ${n} 条…`,
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
      detailsHeading: '失败原因',
      impactHeading: '影响范围',
      recoveryHeading: '建议处理',
      recoveryActions: {
        parse_error: ['检查工作流脚本语法。', '确认工作流字段使用预期的 snake_case 格式。'],
        aborted: ['本次执行已停止。如仍需要结果，可以重新运行。'],
        timeout: ['重新运行工作流。', '如果仍然超时，建议降低并发或检查模型/API 可用性。'],
        runtime_error: ['优先查看失败智能体。', '已完成智能体的结果仍可按需参考。', '需要继续诊断时，可以复制错误详情。'],
      },
      logsHeading: '技术日志',
      failedAgentsHeading: '智能体执行状态',
      executedAgentsHeading: '智能体执行状态',
      progressHeading: '执行过程',
      scriptHeading: '提交的脚本',
      noExtraDetails: '没有更多诊断信息。',
      copyReason: '复制',
      copyReasonDone: '已复制',
      impactTpl: (done, total, failed) => `已完成 ${done}/${total} 个智能体 · ${failed} 个需要关注`,
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
    saveAria: '复制并编辑工作流…',
    saveTitle: '在工作流中心打开复制草案',
    savePlaceholder: 'snake_case 名字',
    saveSubmit: '保存',
    saveCancel: '取消',
    saveDispatched: '已保存',
    copyAria: '复制结果',
    copyDoneAria: '已复制',
    moreAria: '更多操作',
    openInWorkflowsAria: '在工作流中心打开',
    openInWorkflowsTitle: '在工作流中心查看此工作流',
    viewSubagentsHeading: '查看智能体',
    runningProgressHeading: '当前进展',
    runningAgentsHeading: '正在运行',
    completedAgentsHeading: '已完成',
    queuedAgentsHeading: '排队中',
    failedAgentsHeading: '需要关注',
    currentProgressTpl: (phase, running, done, total) => {
      const phaseText = phase ? `正在执行 ${phase}` : '工作流正在执行';
      return `${phaseText} · ${running} 个运行中 · 已完成 ${done}/${total}`;
    },
    recentLogsHeading: '最近更新',
    showAllLogs: '显示全部',
  };
}

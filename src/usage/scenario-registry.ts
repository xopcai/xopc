import type { AiUsageCategory, AiUsageTrigger } from './types.js';

type Scenario = {
  category: AiUsageCategory;
  reasonKey: string;
  trigger: AiUsageTrigger;
};

const SCENARIOS: Readonly<Record<string, Scenario>> = {
  'agent.answer': { category: 'chat', reasonKey: 'usage.reason.agentAnswer', trigger: 'user' },
  'agent.continue_after_tool': { category: 'tool_loop', reasonKey: 'usage.reason.continueAfterTool', trigger: 'agent' },
  'agent.background_review': { category: 'delegation', reasonKey: 'usage.reason.backgroundReview', trigger: 'agent' },
  'session.compact': { category: 'compaction', reasonKey: 'usage.reason.sessionCompaction', trigger: 'system' },
  'session.generate_title': { category: 'session_title', reasonKey: 'usage.reason.sessionTitle', trigger: 'system' },
  'media.understand_image': { category: 'image_understanding', reasonKey: 'usage.reason.imageUnderstanding', trigger: 'user' },
  'tool.web_extract': { category: 'web_extract', reasonKey: 'usage.reason.webExtract', trigger: 'agent' },
  'tool.session_search_summarize': { category: 'session_search', reasonKey: 'usage.reason.sessionSearch', trigger: 'agent' },
  'note.generate': { category: 'note_generation', reasonKey: 'usage.reason.noteGeneration', trigger: 'user' },
  'automation.generate_draft': { category: 'automation', reasonKey: 'usage.reason.automationDraft', trigger: 'user' },
  'scene.execute': { category: 'scene', reasonKey: 'usage.reason.sceneExecution', trigger: 'scheduled' },
  'task.plan_contract': { category: 'task_planning', reasonKey: 'usage.reason.taskPlanning', trigger: 'agent' },
  'task.judge_result': { category: 'task_judging', reasonKey: 'usage.reason.taskJudging', trigger: 'agent' },
  'voice.summarize_for_tts': { category: 'voice_summary', reasonKey: 'usage.reason.voiceSummary', trigger: 'user' },
  'voice.select': { category: 'voice_summary', reasonKey: 'usage.reason.voiceSelection', trigger: 'user' },
  'home.generate_advice': { category: 'home_intelligence', reasonKey: 'usage.reason.homeAdvice', trigger: 'system' },
  'work_discovery.analyze': { category: 'work_discovery', reasonKey: 'usage.reason.workDiscovery', trigger: 'user' },
  'work_discovery.investigate': { category: 'work_discovery', reasonKey: 'usage.reason.workInvestigation', trigger: 'user' },
  'discussion.analyze': { category: 'discussion_analysis', reasonKey: 'usage.reason.discussionAnalysis', trigger: 'user' },
  'text_assist.generate': { category: 'other', reasonKey: 'usage.reason.textAssist', trigger: 'user' },
  'user_model.interpret': { category: 'other', reasonKey: 'usage.reason.userModelInterpretation', trigger: 'system' },
};

export function resolveAiUsageScenario(operation: string): Scenario {
  return SCENARIOS[operation] ?? {
    category: 'other',
    reasonKey: 'usage.reason.other',
    trigger: 'system',
  };
}

import type { FollowUpSuggestionId } from '@/features/chat/follow-up-suggestions.types';

export type FollowUpPromptLocale = 'en' | 'zh';

const PROMPTS: Record<FollowUpSuggestionId, Record<FollowUpPromptLocale, string>> = {
  code_error_handling: {
    en: 'Add error handling and edge cases for the code or approach you described.',
    zh: '为刚才讨论的代码或方案补充错误处理和边界情况。',
  },
  code_refactor: {
    en: 'Refactor that code for readability while preserving behavior.',
    zh: '在保持行为不变的前提下重构这段代码，提高可读性。',
  },
  code_explain: {
    en: 'Explain that code step by step.',
    zh: '逐步解释这段代码的逻辑。',
  },
  code_optimize: {
    en: 'Suggest performance optimizations for that code.',
    zh: '针对这段代码提出性能优化建议。',
  },
  code_add_tests: {
    en: 'Add unit or integration tests for the code we just discussed or changed, and say what each test covers.',
    zh: '为刚才讨论或修改的代码补充单元测试或集成测试，并说明每个测试覆盖什么。',
  },
  code_fix_error: {
    en: 'Diagnose the error above, fix the root cause in code if needed, and explain what you changed.',
    zh: '根据上面的报错定位根因，如有需要直接改代码修复，并说明改动。',
  },
  web_more_details: {
    en: 'Search for more details online and summarize what you find in the context of this answer.',
    zh: '在网上搜索更多相关资料，并结合当前回答做简要总结。',
  },
  web_find_sources: {
    en: 'Find reliable primary or secondary sources online and cite them briefly.',
    zh: '查找可靠的一手或二手来源并简要引用。',
  },
  web_verify_claim: {
    en: 'Verify one or two key factual claims from your answer with a quick web search and note the sources.',
    zh: '用搜索核实回答中一两个关键结论，并注明来源。',
  },
  research_deeper: {
    en: 'Dig deeper on the main topic with web search, focusing on what matters most to me.',
    zh: '围绕主题做更深入的检索，聚焦我最关心的子问题。',
  },
  date_shorter_summary: {
    en: 'Give a shorter summary focusing on the key dates and outcomes.',
    zh: '给一段更短的摘要，突出关键日期和结果。',
  },
  date_main_risks: {
    en: 'What are the main risks or unknowns related to this timeline or plan?',
    zh: '这个时间线或计划的主要风险和未知因素有哪些？',
  },
  email_make_formal: {
    en: 'Rewrite the email or message in a more formal professional tone.',
    zh: '把这封邮件或消息改写成更正式、专业的语气。',
  },
  email_shorten: {
    en: 'Shorten the email or message while keeping the essential meaning.',
    zh: '精简这段邮件或消息，保留核心意思。',
  },
  generic_simpler_terms: {
    en: 'Explain that again in simpler terms for a non-expert reader.',
    zh: '用更通俗的话再解释一遍，面向非专业读者。',
  },
  generic_concrete_example: {
    en: 'Give a concrete example that illustrates the main idea.',
    zh: '举一个具体例子说明核心观点。',
  },
  generic_bullet_points: {
    en: 'Summarize the answer as concise bullet points.',
    zh: '把回答整理成简洁的要点列表。',
  },
  generic_create_table: {
    en: 'Present the main structured information as a Markdown table.',
    zh: '把主要结构化信息整理成 Markdown 表格。',
  },
  generic_action_checklist: {
    en: 'Turn your recommendations into a prioritized action checklist I can follow.',
    zh: '把你的建议整理成可按优先级执行的行动清单。',
  },
  generic_assumptions: {
    en: 'List the key assumptions in your answer and what changes if each assumption is wrong.',
    zh: '列出回答中的关键假设，并说明每个假设不成立时会怎样。',
  },
  learn_technical_detail: {
    en: 'Go deeper into the technical implementation of what you explained (architecture, key steps, and tradeoffs).',
    zh: '针对刚才讲的内容，深入说明技术实现细节（架构、关键步骤和权衡）。',
  },
  learn_build_walkthrough: {
    en: 'Walk me through how to build a minimal working example step by step.',
    zh: '一步步带我从零搭建一个最小可运行的示例。',
  },
  learn_compare_alternatives: {
    en: 'Compare this approach to reasonable alternatives (pros, cons, when to use each).',
    zh: '把这个方案和常见替代方案做对比（优缺点、适用场景）。',
  },
  wf_run_checks: {
    en: 'Run the relevant tests, lint, or type checks in the project and report the results.',
    zh: '在项目里运行相关的测试、lint 或类型检查，并汇报结果。',
  },
  wf_git_commit: {
    en: 'Draft a commit message for the current changes and list the git commands I should run (do not push unless I ask).',
    zh: '根据当前改动起草 commit message，并列出建议执行的 git 命令（除非我要求否则不要 push）。',
  },
  wf_compare_options: {
    en: 'Compare the options you mentioned in a table with pros, cons, and a recommendation.',
    zh: '用表格对比你提到的各方案（优缺点），并给出推荐。',
  },
  wf_verify_acceptance: {
    en: 'Check the work against my original goal and list any gaps or acceptance criteria still open.',
    zh: '对照我最初的目标检查完成情况，列出尚未满足的验收项。',
  },
  ops_fix_config: {
    en: 'Review my xopc/gateway/channel configuration in light of this conversation and suggest concrete fixes.',
    zh: '结合这次对话检查 xopc/gateway/通道相关配置，并给出具体修改建议。',
  },
  ops_channel_next: {
    en: 'Give a short checklist to verify gateway and channel setup works end-to-end on my machine.',
    zh: '给出一份清单，帮我在本机端到端验证 gateway 和通道是否正常。',
  },
  ops_schedule_cron: {
    en: 'Propose a cron job or scheduled task configuration for what we discussed, using the project’s cron tools.',
    zh: '根据我们讨论的内容，用项目的 cron 能力起草定时任务配置。',
  },
  what_next: {
    en: 'What should I do next based on your answer?',
    zh: '根据你的回答，我接下来应该做什么？',
  },
};

export function followUpPromptForSuggestionId(
  id: FollowUpSuggestionId,
  locale: FollowUpPromptLocale = 'en',
): string {
  const row = PROMPTS[id];
  return row[locale] ?? row.en;
}

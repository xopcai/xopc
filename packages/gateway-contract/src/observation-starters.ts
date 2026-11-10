import { z } from 'zod';

export const ObservationStarterKindSchema = z.enum(['pr_review', 'issue_digest', 'work_summary']);
export const ObservationStarterSchema = z.object({
  kind: ObservationStarterKindSchema,
  topicIds: z.array(z.string()).min(1).max(8),
  requestCount: z.number().int().min(2),
  previews: z.array(z.string()).max(2),
});
export const ObservationPrepareRequestSchema = z.strictObject({
  kind: ObservationStarterKindSchema,
  topicIds: z.array(z.string().min(1)).min(1).max(8),
  expectedRevision: z.number().int().positive(),
  idempotencyKey: z.string().min(1).max(120),
  locale: z.enum(['zh', 'en']),
});
export type ObservationStarter = z.infer<typeof ObservationStarterSchema>;
export type ObservationPrepareRequest = z.infer<typeof ObservationPrepareRequestSchema>;

export const OBSERVATION_STARTER_COPY = {
  pr_review: {
    zh: { deliverables: ['相关 PR 和原始链接', '每个 PR 建议核查的内容', '还缺哪些代码或资料'], title: 'PR 审查准备清单', output: '把近期要审的 PR、需要核查的点和缺少的资料整理成一份清单。', criteria: ['每个 PR 附上原始请求或链接', '区分待核查项与已验证结论，未读取代码时不得给出审查通过结论'] },
    en: { deliverables: ['Related PRs and original links', 'Suggested checks for each PR', 'Code or source material still needed'], title: 'PR review preparation', output: 'A checklist of requested PR reviews, points to inspect and missing source material.', criteria: ['Link each PR to its original request or URL', 'Distinguish suggested checks from verified findings; never approve code that has not been read'] },
  },
  issue_digest: {
    zh: { deliverables: ['相关问题和原始线索', '已知信息与待确认的判断', '下一步排查需要的日志或资料'], title: '问题排查摘要', output: '把近期的问题线索、已知事实和待补充的信息整理好，方便继续排查。', criteria: ['每条问题线索标明来源', '区分用户描述、已证实事实和假设，不把缺少日志的问题说成已经解决'] },
    en: { deliverables: ['Issues and their original reports', 'Known information and open questions', 'Logs or material needed for the next step'], title: 'Issue investigation brief', output: 'A brief of recent issue reports, known facts and information needed for investigation.', criteria: ['Cite the source of every issue report', 'Separate user reports, verified facts and hypotheses; do not claim a fix without evidence'] },
  },
  work_summary: {
    zh: { deliverables: ['按项目归类的工作条目', '已确认进展和仍待确认的事项', '待办与阻塞'], title: '工作进展草稿', output: '按项目归纳近期工作、待办和阻塞，生成一份可修改的进展草稿。', criteria: ['工作条目附来源，缺少项目归属时明确标注', '区分工作请求与完成结果，不把用户提出的任务当作已经完成'] },
    en: { deliverables: ['Work items grouped by project', 'Confirmed progress and items needing confirmation', 'Pending work and blockers'], title: 'Work progress draft', output: 'An editable draft grouping recent work, pending items and blockers by project.', criteria: ['Cite work items and flag unknown project ownership', 'Distinguish requested tasks from completed outcomes; requests alone do not prove completion'] },
  },
} as const;

import { z } from 'zod';

import { getSqliteDatabase } from '../storage/sqlite/transaction.js';

export const PersonalOnboardingStepSchema = z.enum(['intro', 'identity', 'voice', 'connections']);
export const PersonalOnboardingDraftSchema = z.object({
  displayName: z.string().trim().min(1).max(60).default('Ada'),
  appearance: z.enum(['loopi', 'loopi-curious', 'loopi-care']).default('loopi'),
  voice: z.string().trim().min(1).max(200).nullable().default(null),
}).strict();
export type PersonalOnboardingDraft = z.infer<typeof PersonalOnboardingDraftSchema>;
export type PersonalOnboardingStep = z.infer<typeof PersonalOnboardingStepSchema>;

export function getPersonalOnboarding(ownerId: string): {
  step: PersonalOnboardingStep;
  draft: PersonalOnboardingDraft;
  completed: boolean;
  welcomeDone: boolean;
} {
  const row = getSqliteDatabase().prepare(`SELECT step, draft_json, completed_at, welcome_finished_at
    FROM personal_agent_onboarding WHERE owner_id = ?`).get(ownerId) as
    { step: string; draft_json: string; completed_at: number | null; welcome_finished_at: number | null } | undefined;
  return {
    step: PersonalOnboardingStepSchema.safeParse(row?.step).data ?? 'intro',
    draft: PersonalOnboardingDraftSchema.parse(row ? JSON.parse(row.draft_json) : {}),
    completed: row?.completed_at != null,
    welcomeDone: row?.welcome_finished_at != null,
  };
}

export function savePersonalOnboarding(ownerId: string, step: PersonalOnboardingStep, draft: PersonalOnboardingDraft): void {
  getSqliteDatabase().prepare(`INSERT INTO personal_agent_onboarding
    (owner_id, step, draft_json, completed_at, updated_at) VALUES (?, ?, ?, NULL, ?)
    ON CONFLICT(owner_id) DO UPDATE SET step = excluded.step, draft_json = excluded.draft_json,
      updated_at = excluded.updated_at WHERE completed_at IS NULL`)
    .run(ownerId, step, JSON.stringify(draft), Date.now());
}

export function completePersonalOnboarding(ownerId: string): void {
  const now = Date.now();
  getSqliteDatabase().prepare(`INSERT INTO personal_agent_onboarding
    (owner_id, step, draft_json, completed_at, updated_at) VALUES (?, 'connections', '{}', ?, ?)
    ON CONFLICT(owner_id) DO UPDATE SET completed_at = COALESCE(completed_at, excluded.completed_at),
      updated_at = excluded.updated_at`).run(ownerId, now, now);
}

export function finishPersonalWelcome(ownerId: string): void {
  getSqliteDatabase().prepare(`UPDATE personal_agent_onboarding
    SET welcome_finished_at = COALESCE(welcome_finished_at, ?), updated_at = ? WHERE owner_id = ?`)
    .run(Date.now(), Date.now(), ownerId);
}

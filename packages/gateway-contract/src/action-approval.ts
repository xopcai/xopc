import { z } from 'zod';

/** Ordinary action approval; independent tool, account and OS limits still apply. */
export const ActionApprovalModeSchema = z.enum(['ask', 'full']);
export type ActionApprovalMode = z.infer<typeof ActionApprovalModeSchema>;

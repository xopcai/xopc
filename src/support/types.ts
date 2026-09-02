import { z } from 'zod';

export const SupportReportInputSchema = z.object({
  problem: z.string().trim().min(1).max(10_000),
  expected: z.string().trim().max(5_000).optional(),
  reproduction: z.string().trim().max(10_000).optional(),
  occurredAt: z.string().datetime().optional(),
  sessionKey: z.string().trim().max(1_000).optional(),
  requestId: z.string().trim().max(1_000).optional(),
  clientContext: z.object({
    currentPage: z.string().trim().max(2_000).optional(),
    rendererError: z.string().trim().max(20_000).optional(),
    surface: z.enum(['web', 'electron']).optional(),
    userAgent: z.string().trim().max(2_000).optional(),
  }).strict().optional(),
}).strict();

export type SupportReportInput = z.infer<typeof SupportReportInputSchema>;

export type SupportDoctorCheck = {
  id: string;
  label: string;
  status: 'pass' | 'warn' | 'fail' | 'skip';
  message: string;
  hints: string[];
};

export type SupportLogEntry = {
  timestamp: string;
  level: string;
  message: string;
  module?: string;
  phase?: string;
  requestId?: string;
  sessionId?: string;
  error?: {
    name?: string;
    message?: string;
    stack?: string;
  };
};

export type SupportRuntimeSnapshot = {
  gatewayStatus?: string;
  gatewayVersion?: string;
  gatewayUptimeMs?: number;
  channels?: Record<string, string>;
};

export type SupportReport = {
  schemaVersion: 1;
  title: string;
  capturedAt: string;
  occurredAt: string;
  problem: string;
  expected?: string;
  reproduction?: string;
  environment: {
    xopcVersion: string;
    nodeVersion: string;
    platform: NodeJS.Platform;
    arch: string;
    surface?: 'web' | 'electron';
    currentPage?: string;
    userAgent?: string;
  };
  runtime?: SupportRuntimeSnapshot;
  rendererError?: string;
  doctor: SupportDoctorCheck[];
  logs: SupportLogEntry[];
  logWindow: { from: string; to: string };
  redaction: { replacements: number };
  markdown: string;
};

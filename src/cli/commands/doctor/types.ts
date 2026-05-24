export type CheckStatus = 'pass' | 'warn' | 'fail' | 'skip';

export interface CheckResult {
  id: string;
  label: string;
  status: CheckStatus;
  message: string;
  hints: string[];
  fixed?: boolean;
  /** Structured gateway security findings (security-audit check). */
  findings?: Array<{
    checkId: string;
    severity: 'critical' | 'warn' | 'info';
    title: string;
    detail: string;
    remediation?: string;
  }>;
}

export interface DoctorOptions {
  fix: boolean;
  json: boolean;
  deep: boolean;
  /** Run gateway security audit only (structured findings). */
  security: boolean;
}

export interface DoctorContext {
  configPath: string;
  stateDir: string;
  options: DoctorOptions;
}

export type DoctorCheck = (ctx: DoctorContext) => Promise<CheckResult>;

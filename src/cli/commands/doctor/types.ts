export type CheckStatus = 'pass' | 'warn' | 'fail' | 'skip';

export interface CheckResult {
  id: string;
  label: string;
  status: CheckStatus;
  message: string;
  hints: string[];
  fixed?: boolean;
}

export interface DoctorOptions {
  fix: boolean;
  json: boolean;
  deep: boolean;
}

export interface DoctorContext {
  configPath: string;
  stateDir: string;
  options: DoctorOptions;
}

export type DoctorCheck = (ctx: DoctorContext) => Promise<CheckResult>;

import type {
  LocalAppAcceptanceInput,
  LocalAppAcceptanceRun,
  LocalAppAcceptanceScenarioSummary,
  LocalAppChangedFile,
  LocalAppDetail,
  LocalAppDiagnostic,
  LocalAppDiagnosticPhase,
  LocalAppFixGuidance,
  LocalAppFixGuidanceInput,
  LocalAppInstallationState,
  LocalAppRecord,
  LocalAppRelease,
  LocalAppReleaseHealth,
  LocalAppStatus,
  LocalAppValidationIssue,
  LocalAppValidationResult,
} from '@xopcai/gateway-contract';

export type LocalApp = LocalAppRecord;
export type RecordLocalAppAcceptanceInput = LocalAppAcceptanceInput;

export type {
  LocalAppAcceptanceRun,
  LocalAppAcceptanceScenarioSummary,
  LocalAppChangedFile,
  LocalAppDetail,
  LocalAppDiagnostic,
  LocalAppDiagnosticPhase,
  LocalAppFixGuidance,
  LocalAppFixGuidanceInput,
  LocalAppInstallationState,
  LocalAppRelease,
  LocalAppReleaseHealth,
  LocalAppStatus,
  LocalAppValidationIssue,
  LocalAppValidationResult,
};

export interface LocalAppUiGrant {
  granted: boolean;
  extensionId: string;
  appId?: string;
  manifestDigest?: string;
  permissions: string[];
  grantedAt?: number;
}

export interface CreateLocalAppInput {
  name: string;
  idea: string;
  description?: string;
}

export interface LocalAppPreviewTarget {
  app: LocalApp;
  previewToken: string;
  uiRoot: string;
}

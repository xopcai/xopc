import type { SupportReportSeed } from './support-report-dialog';

export const OPEN_SUPPORT_REPORT_EVENT = 'open-support-report';

export function openSupportReport(seed: SupportReportSeed = {}): void {
  window.dispatchEvent(new CustomEvent<SupportReportSeed>(OPEN_SUPPORT_REPORT_EVENT, { detail: seed }));
}

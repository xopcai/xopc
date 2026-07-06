/**
 * Reachability TYPES + display helpers used by the settings UI.
 *
 * The actual probe execution lives in `probe-coordinator.ts` so all callers
 * share a single race/cache pipeline. This file exists only for type +
 * formatting convenience.
 */
import type { GatewayRouteProbeReason } from '../../api/connection-strategy';

export type RouteReachabilityStatus =
  | 'checking'
  | 'reachable'
  | 'unreachable'
  | 'not_configured';

export type RouteReachabilityInfo = {
  status: RouteReachabilityStatus;
  reason?: GatewayRouteProbeReason;
  httpStatus?: number;
  detail?: string;
  latencyMs?: number;
};

export type GatewayRouteReachability = {
  lan: RouteReachabilityInfo;
  tunnel: RouteReachabilityInfo;
};

export function reachabilityStatusLabel(
  status: RouteReachabilityStatus,
  labels: {
    reachable: string;
    unreachable: string;
    checking: string;
  },
): string {
  switch (status) {
    case 'reachable':
      return labels.reachable;
    case 'unreachable':
      return labels.unreachable;
    case 'checking':
      return labels.checking;
    case 'not_configured':
      return '';
  }
}

export function reachabilityStatusColor(
  status: RouteReachabilityStatus,
  palette: { success: string; error: string; muted: string },
): string {
  switch (status) {
    case 'reachable':
      return palette.success;
    case 'unreachable':
      return palette.error;
    case 'checking':
      return palette.muted;
    case 'not_configured':
      return palette.muted;
  }
}

export function formatReachabilityReason(
  info: RouteReachabilityInfo,
  labels: {
    timeout: string;
    networkError: string;
    networkErrorWithDetail: string;
    invalidUrl: string;
    httpError: string;
  },
): string {
  if (info.status !== 'unreachable' || !info.reason) return '';

  switch (info.reason) {
    case 'timeout':
      return labels.timeout;
    case 'invalid_url':
      return labels.invalidUrl;
    case 'http_error':
      return labels.httpError.replace('{{status}}', String(info.httpStatus ?? '?'));
    case 'network_error':
      if (info.detail) {
        return labels.networkErrorWithDetail.replace('{{detail}}', info.detail);
      }
      return labels.networkError;
  }
}

/**
 * Daemon - Cross-platform service management for xopc gateway
 *
 * Provides unified interface for:
 * - macOS: LaunchAgent (launchd)
 * - Linux: systemd user service
 * - Windows: Scheduled Task (schtasks)
 *
 * @example
 * ```typescript
 * import { resolveGatewayService, isDaemonAvailableAsync, startGatewayService } from './daemon/index.js';
 *
 * const service = await resolveGatewayService();
 * const loaded = await service.isLoaded({ env: process.env });
 *
 * if (!loaded) {
 *   await service.install({ ... });
 * }
 *
 * const result = await startGatewayService({ service });
 * ```
 */

export * from './types.js';
export * from './constants.js';
export * from './service.js';
export * from './install-plan.js';

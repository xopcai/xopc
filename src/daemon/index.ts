/**
 * Daemon - Cross-platform service management for xopcbot gateway
 *
 * Provides unified interface for:
 * - Linux: systemd user service
 * - macOS: LaunchAgent
 * - Windows: Scheduled Task
 *
 * @example
 * ```typescript
 * import { resolveGatewayService, isDaemonAvailable } from './daemon/index.js';
 *
 * const service = await resolveGatewayService();
 * const loaded = await service.isLoaded({ env: process.env });
 *
 * if (!loaded) {
 *   await service.install({ ... });
 * }
 *
 * await service.start({ env: process.env });
 * ```
 */

export * from './types.js';
export * from './service.js';
export * from './install-plan.js';

export { isDaemonAvailableAsync } from './service.js';

/**
 * Map gateway `manageRoute` (web hash settings paths) to Expo Router paths in the mobile app.
 */
export function mapManageRouteToAppPath(manageRoute: string | undefined): string | null {
  const r = manageRoute?.trim();
  if (!r) return null;
  switch (r) {
    case '/settings/agents':
      return '/ai/agents';
    case '/settings/gateway':
      return '/settings/gateway';
    case '/settings/automation':
    case '/settings/schedules':
    case '/settings/cron':
      return '/automation';
    case '/settings/sharing':
    case '/settings/shares':
      return '/sharing';
    case '/settings/skills':
    case '/settings/sessions':
      return null;
    default:
      return null;
  }
}

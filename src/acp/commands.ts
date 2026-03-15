/**
 * ACP Available Commands
 */

export interface AcpCommand {
  name: string;
  description: string;
}

/**
 * Get available ACP commands
 */
export function getAvailableCommands(): AcpCommand[] {
  return [
    {
      name: "session.reset",
      description: "Reset the session",
    },
    {
      name: "session.status",
      description: "Get session status",
    },
  ];
}

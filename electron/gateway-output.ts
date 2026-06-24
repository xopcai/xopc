function parsePort(value: string | undefined): number | null {
  if (!value) return null;
  const port = Number.parseInt(value, 10);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
}

/**
 * Extract the embedded gateway's actual HTTP listen port from recent child output.
 * Prefer the latest matching line because startup output can include stale retry text.
 */
export function parseGatewayListenPortFromOutput(output: string): number | null {
  const lines = output.split(/\r?\n/).reverse();
  for (const line of lines) {
    const urlMatch = line.match(
      /\bURL:\s*https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):(\d{1,5})\b/i,
    );
    const urlPort = parsePort(urlMatch?.[1]);
    if (urlPort !== null) return urlPort;

    const runningMatch = line.match(
      /\bGateway server running at\s+https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):(\d{1,5})\b/i,
    );
    const runningPort = parsePort(runningMatch?.[1]);
    if (runningPort !== null) return runningPort;

    const startingMatch = line.match(
      /\bStarting gateway server on\s+(?:localhost|127\.0\.0\.1|\[::1\]):(\d{1,5})\b/i,
    );
    const startingPort = parsePort(startingMatch?.[1]);
    if (startingPort !== null) return startingPort;

    const portLineMatch = line.match(/^\s*Port:\s*(\d{1,5})\s*$/i);
    const portLinePort = parsePort(portLineMatch?.[1]);
    if (portLinePort !== null) return portLinePort;
  }
  return null;
}

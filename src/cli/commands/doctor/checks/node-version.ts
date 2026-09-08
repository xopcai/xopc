import type { CheckResult, DoctorContext } from '../types.js';

const MINIMUM_NODE_VERSION = [22, 22, 3] as const;

function parseNodeVersion(): [number, number, number] | undefined {
  const match = process.version.match(/^v(\d+)\.(\d+)\.(\d+)/);
  return match
    ? [Number.parseInt(match[1]!, 10), Number.parseInt(match[2]!, 10), Number.parseInt(match[3]!, 10)]
    : undefined;
}

function meetsMinimumVersion(version: [number, number, number]): boolean {
  for (const [index, minimum] of MINIMUM_NODE_VERSION.entries()) {
    if (version[index]! > minimum) return true;
    if (version[index]! < minimum) return false;
  }
  return true;
}

export async function checkNodeVersion(_ctx: DoctorContext): Promise<CheckResult> {
  const version = parseNodeVersion();
  if (!version) {
    return {
      id: 'node-version',
      label: 'Host Node.js',
      status: 'warn',
      message: 'Could not parse Node.js version.',
      hints: [`process.version=${process.version}`],
    };
  }
  if (!meetsMinimumVersion(version)) {
    return {
      id: 'node-version',
      label: 'Host Node.js',
      status: 'fail',
      message: `Node.js ${process.version} is below the required minimum (22.22.3).`,
      hints: ['Install Node.js 22.22.3+ from https://nodejs.org/'],
    };
  }
  return {
    id: 'node-version',
    label: 'Host Node.js',
    status: 'pass',
    message: `Node.js ${process.version} meets the project requirement (>= 22.22.3).`,
    hints: [],
  };
}

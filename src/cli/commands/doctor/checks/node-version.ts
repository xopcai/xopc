import type { CheckResult, DoctorContext } from '../types.js';

function parseNodeMajorVersion(): number {
  const match = process.version.match(/^v(\d+)/);
  return match ? parseInt(match[1]!, 10) : 0;
}

export async function checkNodeVersion(_ctx: DoctorContext): Promise<CheckResult> {
  const major = parseNodeMajorVersion();
  if (major === 0) {
    return {
      id: 'node-version',
      label: 'Node.js',
      status: 'warn',
      message: 'Could not parse Node.js version.',
      hints: [`process.version=${process.version}`],
    };
  }
  if (major < 22) {
    return {
      id: 'node-version',
      label: 'Node.js',
      status: 'fail',
      message: `Node ${major} is below the required minimum (22).`,
      hints: ['Install Node.js 22+ from https://nodejs.org/'],
    };
  }
  return {
    id: 'node-version',
    label: 'Node.js',
    status: 'pass',
    message: `Node.js ${process.version} meets the project requirement (>= 22).`,
    hints: [],
  };
}

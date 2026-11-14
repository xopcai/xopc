import { tryRunGatewayRunFastPath } from './gateway-run-fast-path.js';

export async function runBundledGateway(argv: string[]): Promise<boolean> {
  await import('../infra/http-proxy-env.js');
  return tryRunGatewayRunFastPath(argv);
}

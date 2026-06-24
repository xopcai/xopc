import { describe, expect, it } from 'vitest';

import { parseGatewayListenPortFromOutput } from '../gateway-output.js';

describe('parseGatewayListenPortFromOutput', () => {
  it('parses the printed gateway URL', () => {
    expect(parseGatewayListenPortFromOutput('URL: http://127.0.0.1:28790\n')).toBe(28790);
  });

  it('parses GatewayServer startup lines', () => {
    expect(
      parseGatewayListenPortFromOutput(
        '[GatewayServer] Starting gateway server on 127.0.0.1:18791...\n',
      ),
    ).toBe(18791);
  });

  it('uses the latest matching listen port', () => {
    expect(
      parseGatewayListenPortFromOutput(
        [
          'Port: 18790',
          '[GatewayServer] Gateway server running at http://127.0.0.1:18791',
        ].join('\n'),
      ),
    ).toBe(18791);
  });

  it('ignores unrelated port fields', () => {
    expect(
      parseGatewayListenPortFromOutput(
        '{"bindPort":19820,"msg":"Browser extension WS server port is already in use"}',
      ),
    ).toBeNull();
  });
});

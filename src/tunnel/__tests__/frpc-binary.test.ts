import { describe, expect, it } from 'vitest';

import {
  buildFrpcReleaseBasename,
  frpcDownloadUrlsForTarget,
  FRPC_VERSION,
} from '../frpc-binary.js';
import { frpcReleaseArchiveExtension } from '../frpc-extract.js';

describe('frpc-binary release URLs', () => {
  it('buildFrpcReleaseBasename matches upstream folder names', () => {
    expect(buildFrpcReleaseBasename('windows', 'amd64', FRPC_VERSION)).toBe(
      `frp_${FRPC_VERSION}_windows_amd64`,
    );
  });

  it('uses .zip for Windows and .tar.gz for other platforms', () => {
    expect(frpcReleaseArchiveExtension('windows')).toBe('.zip');
    expect(frpcReleaseArchiveExtension('linux')).toBe('.tar.gz');
    expect(frpcReleaseArchiveExtension('darwin')).toBe('.tar.gz');
  });

  it('frpcDownloadUrlsForTarget uses platform-specific archive extension', () => {
    const windows = frpcDownloadUrlsForTarget('windows', 'amd64');
    expect(windows.every((url) => url.endsWith('.zip'))).toBe(true);
    expect(windows[0]).toBe(
      `https://frp.xopc.ai/bin/frp_${FRPC_VERSION}_windows_amd64.zip`,
    );
    expect(windows[1]).toBe(
      `https://github.com/fatedier/frp/releases/download/v${FRPC_VERSION}/frp_${FRPC_VERSION}_windows_amd64.zip`,
    );

    const linux = frpcDownloadUrlsForTarget('linux', 'amd64');
    expect(linux.every((url) => url.endsWith('.tar.gz'))).toBe(true);
  });
});

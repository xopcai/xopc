import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'xopc-native-redirect-'));
let redirected = 0;
const target = createServer((req, res) => { redirected++; req.resume(); res.end('unexpected'); });
target.listen(0, '127.0.0.1'); await once(target, 'listening');
const origin = createServer((req, res) => {
  req.resume(); req.on('end', () => res.writeHead(307, { Location: `http://127.0.0.1:${target.address().port}/leak` }).end());
});
origin.listen(0, '127.0.0.1'); await once(origin, 'listening');
try {
  const source = readFileSync('apps/mobile-expo/node_modules/expo-file-system/ios/FileSystemDownloadTask.swift', 'utf8');
  const method = source.match(/  func urlSession\(\n    _ session: URLSession,\n    task: URLSessionTask,\n    willPerformHTTPRedirection[\s\S]*?\n  }/)?.[0];
  assert.ok(method, 'Installed Expo patch is missing');
  writeFileSync(join(root, 'probe.swift'), `import Foundation
final class RedirectDelegate: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
${method}
}
let done = DispatchSemaphore(value: 0)
let delegate = RedirectDelegate()
let session = URLSession(configuration: .ephemeral, delegate: delegate, delegateQueue: nil)
var request = URLRequest(url: URL(string: CommandLine.arguments[1])!)
request.httpMethod = "POST"
request.setValue("Bearer test-only", forHTTPHeaderField: "Authorization")
let task = session.uploadTask(with: request, fromFile: URL(fileURLWithPath: CommandLine.arguments[2])) { _, response, error in
  if let error { print(error); exit(1) }
  guard (response as? HTTPURLResponse)?.statusCode == 307 else { exit(2) }
  done.signal()
}
task.resume()
if done.wait(timeout: .now() + 15) == .timedOut { exit(3) }
session.invalidateAndCancel()
`);
  writeFileSync(join(root, 'body'), Buffer.alloc(1024 * 1024, 7));
  execFileSync('swiftc', ['-swift-version', '5', join(root, 'probe.swift'), '-o', join(root, 'probe')], { stdio: 'pipe' });
  const child = spawn(join(root, 'probe'), [`http://127.0.0.1:${origin.address().port}/upload`, join(root, 'body')], { stdio: 'inherit' });
  const [code] = await once(child, 'exit');
  assert.equal(code, 0);
  assert.equal(redirected, 0);
  console.log('PASS: patched Foundation foreground upload refuses 307; redirect target receives no request');
} finally {
  origin.closeAllConnections(); target.closeAllConnections(); origin.close(); target.close();
  rmSync(root, { recursive: true, force: true });
}

import { REMOTE_BROWSER_FRAME_MAX_BYTES, REMOTE_BROWSER_CONTROL_TOOL } from '@xopcai/browser-control-contract/remote';
import { canonicalJson, desktopExecutionRequestSchema, toolInvokePayloadSchema, type DesktopOperationIntent, type DesktopExecutionRequest } from '@xopcai/endpoint-tools-protocol';

import { DesktopBrowserSession } from './browser-session.js';
import type { DesktopExecutionSession } from './execution-session.js';

type Upload = ConstructorParameters<typeof DesktopBrowserSession>[0]['uploadFrame'];
type Grant = NonNullable<ReturnType<typeof toolInvokePayloadSchema.parse>['uploadGrant']>;
type Active = { request: DesktopExecutionRequest; grant: Grant; uploaded: boolean };

/** Invocation-scoped Browser upload handoff. This adapter never interprets a URL or invokes Electron IPC. */
export class DesktopBrowserHostController {
  private readonly browser: DesktopBrowserSession;
  private active?: Active;
  private closed = false;
  constructor(private readonly options: {
    current(): boolean;
    execution: Pick<DesktopExecutionSession, 'invoke' | 'close'>;
    createSession(uploadFrame: Upload): DesktopBrowserSession;
    uploadFrame(request: DesktopExecutionRequest, grant: Grant, ...frame: [Parameters<Upload>[0], AbortSignal]): ReturnType<Upload>;
  }) {
    this.browser = options.createSession((frame, intent, signal) => this.upload(frame, intent, signal));
  }
  workerFor(intent: DesktopOperationIntent | undefined) {
    const active = this.active;
    if (this.closed || !this.options.current() || !intent || !active
      || canonicalJson(intent) !== canonicalJson(active.request.execution)) throw new Error('DESKTOP_BROWSER_INVOCATION_MISMATCH');
    return this.browser.worker(intent);
  }
  async run(input: unknown) {
    if (this.closed || !this.options.current() || this.active) throw new Error('DESKTOP_BROWSER_BUSY');
    const payload = toolInvokePayloadSchema.parse(JSON.parse(JSON.stringify(input)));
    const { uploadGrant, operationQuery, ...body } = payload;
    const request = desktopExecutionRequestSchema.parse(body);
    if (request.toolName !== REMOTE_BROWSER_CONTROL_TOOL || request.execution.workspaceId || operationQuery
      || !uploadGrant || uploadGrant.path !== `/api/endpoint-tools/invocations/${request.invocationId}/files`
      || uploadGrant.maxFiles !== 1 || uploadGrant.maxBytes > REMOTE_BROWSER_FRAME_MAX_BYTES || uploadGrant.expiresAt <= Date.now()
      || request.deadlineAt <= Date.now() || request.deadlineAt - Date.now() > 30_000) throw new Error('DESKTOP_BROWSER_UPLOAD_GRANT_INVALID');
    const active = { request, grant: uploadGrant, uploaded: false }; this.active = active;
    try {
      return await this.options.execution.invoke(request, { beforeStart: () => {
        if (this.closed || !this.options.current() || this.active !== active) throw new Error('DESKTOP_BROWSER_AUTHORITY_INVALID');
      } });
    } finally { if (this.active === active) this.active = undefined; }
  }
  private async upload(frame: Parameters<Upload>[0], intent: DesktopOperationIntent, signal: AbortSignal) {
    signal.throwIfAborted();
    const active = this.active;
    if (this.closed || !this.options.current() || !active || active.uploaded || active.grant.expiresAt <= Date.now()
      || active.request.deadlineAt <= Date.now() || canonicalJson(intent) !== canonicalJson(active.request.execution)
      || frame.bytes.byteLength > active.grant.maxBytes) throw new Error('DESKTOP_BROWSER_UPLOAD_GRANT_INVALID');
    active.uploaded = true;
    const result = await this.options.uploadFrame(structuredClone(active.request), structuredClone(active.grant), frame, signal);
    signal.throwIfAborted();
    if (this.closed || !this.options.current() || this.active !== active) throw new Error('DESKTOP_BROWSER_AUTHORITY_INVALID');
    return result;
  }
  async close() {
    this.closed = true;
    const [browser, execution] = await Promise.all([this.browser.stop(), this.options.execution.close()]);
    return browser.confirmed ? execution : { state: 'unknown' as const };
  }
}

import { ENDPOINT_TEXT_OUTPUT_SCHEMA, type EndpointToolDescriptor } from '@xopcai/endpoint-tools-protocol';

import type { DesktopExecutionWorker } from './operation-supervisor.js';

export const DESKTOP_CLIPBOARD_WRITE_DESCRIPTOR: EndpointToolDescriptor = {
  name: 'desktop.clipboard.write', title: 'Write clipboard text',
  description: 'Write at most 4000 characters to the explicitly selected computer clipboard after native confirmation. Does not read existing clipboard content.',
  inputSchema: { type: 'object', additionalProperties: false, required: ['text'], properties: { text: { type: 'string', minLength: 1, maxLength: 4000 } } },
  outputSchema: ENDPOINT_TEXT_OUTPUT_SCHEMA, policyId: 'user.foreground-write', sensitivity: 'personal', effect: 'write', confirmation: 'always',
  requiresForeground: true, requiredPermissions: ['clipboard-write'], timeoutMs: 60000, maxConcurrency: 1, supportsCancellation: true, idempotent: false, resultKinds: ['text'],
};

/** Wait for the Electron 45 system request; cancellation cannot retract an already submitted clipboard write. */
export function desktopClipboardWorker(clipboard: { writeText(text: string): Promise<void> }): DesktopExecutionWorker {
  let used = false, stopped = false;
  let pending: Promise<void> | undefined;
  return {
    async run(args, signal) {
      signal.throwIfAborted();
      if (used || stopped || Object.keys(args).length !== 1 || typeof args.text !== 'string' || !args.text.length || [...args.text].length > 4000) throw new Error('DESKTOP_EXECUTION_ARGUMENT_INVALID');
      used = true;
      const text = args.text;
      pending = Promise.resolve().then(() => {
        if (stopped) throw new Error('DESKTOP_EXECUTION_CANCELLED_BEFORE_START');
        signal.throwIfAborted();
        return clipboard.writeText(text);
      });
      await pending;
      return { status: 'succeeded', result: { content: [{ type: 'text', text: 'Clipboard text written.' }] } };
    },
    async stop() {
      stopped = true;
      try { await pending; } catch { /* The request settled; its effect can still be unknown. */ }
      return { confirmed: true };
    },
  };
}

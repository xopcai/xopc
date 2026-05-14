import type { Page, Dialog } from 'playwright-core';

import { createLogger } from '../utils/logger.js';

const log = createLogger('CDPSupervisor');

/** Represents a captured JS dialog event. */
export interface DialogEvent {
  id: string;
  type: 'alert' | 'confirm' | 'prompt' | 'beforeunload';
  message: string;
  defaultValue: string;
  timestamp: number;
  handled: boolean;
  response?: 'accepted' | 'dismissed';
}

/** Console message captured by the supervisor. */
export interface ConsoleEntry {
  type: string;
  text: string;
  timestamp: number;
}

export type DialogPolicy = 'must_respond' | 'auto_dismiss' | 'auto_accept';

export interface CdpSupervisorOptions {
  dialogPolicy: DialogPolicy;
  dialogTimeoutSeconds: number;
  maxConsoleEntries: number;
}

const DEFAULT_OPTIONS: CdpSupervisorOptions = {
  dialogPolicy: 'auto_dismiss',
  dialogTimeoutSeconds: 300,
  maxConsoleEntries: 200,
};

/**
 * CDP Supervisor — persistent event listener for browser pages.
 *
 * Monitors Dialog events, console output, and frame navigation.
 * Aligned with hermes-agent's `CDPSupervisor` pattern but using
 * Playwright's high-level event API instead of raw CDP WebSocket.
 */
export class CdpSupervisor {
  private readonly options: CdpSupervisorOptions;
  private dialogQueue: DialogEvent[] = [];
  private consoleBuffer: ConsoleEntry[] = [];
  private attachedPages = new WeakSet<Page>();
  private dialogCounter = 0;
  private pendingDialog: Dialog | null = null;

  constructor(options?: Partial<CdpSupervisorOptions>) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /** Attach the supervisor to a page to begin monitoring. */
  attach(page: Page): void {
    if (this.attachedPages.has(page)) return;
    this.attachedPages.add(page);

    page.on('dialog', (dialog) => this._onDialog(dialog));
    page.on('console', (msg) => this._onConsole(msg));
    page.on('close', () => this.attachedPages.delete(page));

    log.debug('Supervisor attached to page');
  }

  /** Get all pending (unhandled) dialogs. */
  getPendingDialogs(): DialogEvent[] {
    return this.dialogQueue.filter((d) => !d.handled);
  }

  /** Get all captured dialog events (including handled). */
  getAllDialogs(): DialogEvent[] {
    return [...this.dialogQueue];
  }

  /** Get recent console entries. */
  getConsoleEntries(limit?: number): ConsoleEntry[] {
    const max = limit ?? this.options.maxConsoleEntries;
    return this.consoleBuffer.slice(-max);
  }

  /** Handle a pending dialog by id or the most recent one. */
  async handleDialog(
    action: 'accept' | 'dismiss',
    options?: { dialogId?: string; promptText?: string },
  ): Promise<DialogEvent | undefined> {
    // Find the target dialog event
    let targetEvent: DialogEvent | undefined;
    if (options?.dialogId) {
      targetEvent = this.dialogQueue.find((d) => d.id === options.dialogId && !d.handled);
    } else {
      targetEvent = this.dialogQueue.findLast((d) => !d.handled);
    }

    if (!targetEvent) return undefined;

    // If we still have the live Playwright Dialog reference, use it
    if (this.pendingDialog) {
      try {
        if (action === 'accept') {
          await this.pendingDialog.accept(options?.promptText ?? '');
        } else {
          await this.pendingDialog.dismiss();
        }
      } catch {
        // Dialog may have already been auto-handled or timed out
      }
      this.pendingDialog = null;
    }

    targetEvent.handled = true;
    targetEvent.response = action === 'accept' ? 'accepted' : 'dismissed';
    return targetEvent;
  }

  /** Clear all dialog history. */
  clearDialogs(): void {
    this.dialogQueue = [];
  }

  /** Clear console buffer. */
  clearConsole(): void {
    this.consoleBuffer = [];
  }

  // ── Internal handlers ──────────────────────────────────────────────────

  private _onDialog(dialog: Dialog): void {
    this.dialogCounter += 1;
    const event: DialogEvent = {
      id: `dialog-${this.dialogCounter}`,
      type: dialog.type() as DialogEvent['type'],
      message: dialog.message(),
      defaultValue: dialog.defaultValue(),
      timestamp: Date.now(),
      handled: false,
    };
    this.dialogQueue.push(event);
    this.pendingDialog = dialog;

    log.info({ dialogId: event.id, type: event.type, message: event.message }, 'Dialog detected');

    // Apply auto-handling policy
    switch (this.options.dialogPolicy) {
      case 'auto_accept':
        void dialog.accept().then(() => {
          event.handled = true;
          event.response = 'accepted';
          this.pendingDialog = null;
        }).catch(() => {});
        break;

      case 'auto_dismiss':
        void dialog.dismiss().then(() => {
          event.handled = true;
          event.response = 'dismissed';
          this.pendingDialog = null;
        }).catch(() => {});
        break;

      case 'must_respond':
        // Set a timeout to auto-dismiss if the agent doesn't respond
        setTimeout(() => {
          if (!event.handled) {
            void dialog.dismiss().then(() => {
              event.handled = true;
              event.response = 'dismissed';
              this.pendingDialog = null;
              log.warn({ dialogId: event.id }, 'Dialog auto-dismissed after timeout');
            }).catch(() => {});
          }
        }, this.options.dialogTimeoutSeconds * 1000);
        break;
    }
  }

  private _onConsole(msg: import('playwright-core').ConsoleMessage): void {
    const entry: ConsoleEntry = {
      type: msg.type(),
      text: msg.text(),
      timestamp: Date.now(),
    };
    this.consoleBuffer.push(entry);

    // Trim buffer to max size
    if (this.consoleBuffer.length > this.options.maxConsoleEntries * 1.5) {
      this.consoleBuffer = this.consoleBuffer.slice(-this.options.maxConsoleEntries);
    }
  }
}

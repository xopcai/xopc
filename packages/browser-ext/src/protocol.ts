/**
 * xopc Browser Extension protocol — shared command types between xopc daemon and Chrome extension.
 *
 * Each Action maps to a browser automation operation.
 * xopc sends a Command over WebSocket, extension processes it, returns a Result.
 */

// ── Action types ──────────────────────────────────────────────────────

export type ExtensionAction =
  // Navigation
  | 'open'
  | 'navigate'
  | 'reload'
  | 'back'
  | 'forward'
  | 'get_url'
  | 'get_title'
  // Page state
  | 'state'
  | 'snapshot'
  | 'screenshot'
  | 'content'
  // JavaScript
  | 'evaluate'
  // Element interaction
  | 'click'
  | 'type'
  | 'scroll'
  | 'wait'
  // Selectors
  | 'query_selector'
  | 'query_selector_all'
  | 'wait_for_selector'
  // Mouse input (CDP)
  | 'mouse_move'
  | 'mouse_click'
  | 'mouse_down'
  | 'mouse_up'
  | 'mouse_wheel'
  // Keyboard input (CDP)
  | 'keys'
  | 'keyboard_type'
  | 'keyboard_down'
  | 'keyboard_up'
  | 'keyboard_insert_text'
  // Element helpers
  | 'get_bounding_box'
  | 'get_element_text'
  | 'get_element_attribute'
  | 'get_elements_count'
  | 'set_input_files'
  | 'scroll_into_view'
  // Viewport
  | 'set_viewport_size'
  | 'get_viewport_size'
  // Network events
  | 'network_start'
  | 'network_events'
  | 'network_stop'
  // Dialog
  | 'dialog'
  // Cookies
  | 'get_cookies'
  | 'set_cookies'
  | 'clear_cookies'
  // Lifecycle
  | 'close'
  | 'new_tab'
  | 'list_tabs'
  // CDP passthrough
  | 'cdp'
  // Health check
  | 'ping';

// ── Command ───────────────────────────────────────────────────────────

export interface ExtensionCommand {
  /** Unique request ID for matching responses. */
  id: string;
  /** Action to execute. */
  action: ExtensionAction;
  /** Target tab ID (omit for active tab in automation window). */
  tabId?: number;
  /** Action-specific arguments. */
  args?: Record<string, unknown>;
  /** Command timeout in milliseconds. */
  timeout?: number;
}

// ── Result ────────────────────────────────────────────────────────────

export interface ExtensionResult {
  /** Matching request ID. */
  id: string;
  /** Whether the command succeeded. */
  ok: boolean;
  /** Result data on success. */
  data?: unknown;
  /** Error message on failure. */
  error?: string;
  /** Timing info (ms). */
  durationMs?: number;
}

// ── Network event pushed from Extension to xopc ───────────────────────

export interface NetworkEvent {
  type: 'network_event';
  eventType: 'request' | 'response';
  listenerId: string;
  data: Record<string, unknown>;
}

// ── Status event pushed from Extension ────────────────────────────────

export interface StatusEvent {
  type: 'status';
  connected: boolean;
  tabCount: number;
  activeTabId?: number;
  activeUrl?: string;
}

// ── Connection constants ──────────────────────────────────────────────

/** Default xopc WebSocket server port for extension connections. */
export const XOPC_EXT_PORT = 19820;
export const XOPC_EXT_HOST = '127.0.0.1';
export const XOPC_EXT_WS_URL = `ws://${XOPC_EXT_HOST}:${XOPC_EXT_PORT}/browser-ext`;

/** Reconnect timing. */
export const WS_RECONNECT_BASE_DELAY = 2000;
export const WS_RECONNECT_MAX_DELAY = 5000;

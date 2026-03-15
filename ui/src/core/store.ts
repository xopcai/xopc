// Global State Store - Centralized state management using Zustand
// Replaces scattered @state() decorators and event-based communication

import { createStore } from 'zustand/vanilla';
import { subscribeWithSelector } from 'zustand/middleware';

// ===== Session Types =====
export interface Session {
  key: string;
  name?: string;
  updatedAt: string;
  messageCount: number;
  archived?: boolean;
}

export interface SessionState {
  current: Session | null;
  list: Session[];
  loading: boolean;
  error: string | null;
}

export interface SessionActions {
  setCurrentSession: (session: Session | null) => void;
  setSessionList: (sessions: Session[]) => void;
  addSession: (session: Session) => void;
  updateSession: (key: string, updates: Partial<Session>) => void;
  removeSession: (key: string) => void;
  setSessionLoading: (loading: boolean) => void;
  setSessionError: (error: string | null) => void;
}

// ===== Connection Types =====
export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'reconnecting' | 'error';

export interface ConnectionState {
  status: ConnectionStatus;
  error: string | null;
  reconnectCount: number;
}

export interface ConnectionActions {
  setConnectionStatus: (status: ConnectionStatus) => void;
  setConnectionError: (error: string | null) => void;
  incrementReconnect: () => void;
  resetReconnect: () => void;
}

// ===== Message Types =====
export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: Array<{ type: string; text?: string }>;
  attachments?: Array<{
    type: string;
    mimeType?: string;
    data?: string;
    name?: string;
    size?: number;
  }>;
  timestamp: number;
  isStreaming?: boolean;
  model?: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface StreamingState {
  isActive: boolean;
  content: string;
  message: Message | null;
}

export interface MessageState {
  messages: Message[];
  streaming: StreamingState;
  loading: boolean;
  error: string | null;
}

export interface MessageActions {
  setMessages: (messages: Message[]) => void;
  addMessage: (message: Message) => void;
  updateMessage: (id: string, updates: Partial<Message>) => void;
  removeMessage: (id: string) => void;
  clearMessages: () => void;
  setStreamingActive: (isActive: boolean) => void;
  setStreamingContent: (content: string) => void;
  appendStreamingContent: (content: string) => void;
  finalizeStreaming: () => void;
  setMessageLoading: (loading: boolean) => void;
  setMessageError: (error: string | null) => void;
}

// ===== Route Types =====
export type ChatRouteType = 'recent' | 'session' | 'new';

export interface ChatRoute {
  type: ChatRouteType;
  sessionKey?: string;
}

export interface RouteState {
  current: ChatRoute;
  previous: ChatRoute | null;
  transitioning: boolean;
}

export interface RouteActions {
  navigateRoute: (route: ChatRoute) => void;
  setRouteTransitioning: (transitioning: boolean) => void;
}

// ===== App State =====
export interface AppState {
  session: SessionState;
  connection: ConnectionState;
  message: MessageState;
  route: RouteState;
}

export type AppActions = SessionActions & ConnectionActions & MessageActions & RouteActions;

// ===== Store Creation =====
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export const createAppStore = () =>
  createStore(
    subscribeWithSelector<AppState & AppActions>((set, get) => ({
      // ===== Session State =====
      session: {
        current: null,
        list: [],
        loading: false,
        error: null,
      },

      // ===== Connection State =====
      connection: {
        status: 'disconnected',
        error: null,
        reconnectCount: 0,
      },

      // ===== Message State =====
      message: {
        messages: [],
        streaming: {
          isActive: false,
          content: '',
          message: null,
        },
        loading: false,
        error: null,
      },

      // ===== Route State =====
      route: {
        current: { type: 'recent' },
        previous: null,
        transitioning: false,
      },

      // ===== Session Actions =====
      setCurrentSession: (session) =>
        set((state) => ({
          session: { ...state.session, current: session },
        })),

      setSessionList: (sessions) =>
        set((state) => ({
          session: { ...state.session, list: sessions },
        })),

      addSession: (session) =>
        set((state) => ({
          session: {
            ...state.session,
            list: [session, ...state.session.list],
          },
        })),

      updateSession: (key, updates) =>
        set((state) => ({
          session: {
            ...state.session,
            list: state.session.list.map((s) =>
              s.key === key ? { ...s, ...updates } : s
            ),
          },
        })),

      removeSession: (key) =>
        set((state) => ({
          session: {
            ...state.session,
            list: state.session.list.filter((s) => s.key !== key),
          },
        })),

      setSessionLoading: (loading) =>
        set((state) => ({
          session: { ...state.session, loading },
        })),

      setSessionError: (error) =>
        set((state) => ({
          session: { ...state.session, error },
        })),

      // ===== Connection Actions =====
      setConnectionStatus: (status) =>
        set((state) => ({
          connection: { ...state.connection, status },
        })),

      setConnectionError: (error) =>
        set((state) => ({
          connection: { ...state.connection, error },
        })),

      incrementReconnect: () =>
        set((state) => ({
          connection: {
            ...state.connection,
            reconnectCount: state.connection.reconnectCount + 1,
          },
        })),

      resetReconnect: () =>
        set((state) => ({
          connection: { ...state.connection, reconnectCount: 0 },
        })),

      // ===== Message Actions =====
      setMessages: (messages) =>
        set((state) => ({
          message: { ...state.message, messages },
        })),

      addMessage: (message) =>
        set((state) => ({
          message: {
            ...state.message,
            messages: [...state.message.messages, message],
          },
        })),

      updateMessage: (id, updates) =>
        set((state) => ({
          message: {
            ...state.message,
            messages: state.message.messages.map((m) =>
              m.id === id ? { ...m, ...updates } : m
            ),
          },
        })),

      removeMessage: (id) =>
        set((state) => ({
          message: {
            ...state.message,
            messages: state.message.messages.filter((m) => m.id !== id),
          },
        })),

      clearMessages: () =>
        set((state) => ({
          message: {
            ...state.message,
            messages: [],
            streaming: { isActive: false, content: '', message: null },
          },
        })),

      setStreamingActive: (isActive) =>
        set((state) => ({
          message: {
            ...state.message,
            streaming: { ...state.message.streaming, isActive },
          },
        })),

      setStreamingContent: (content) =>
        set((state) => ({
          message: {
            ...state.message,
            streaming: { ...state.message.streaming, content },
          },
        })),

      appendStreamingContent: (content) =>
        set((state) => ({
          message: {
            ...state.message,
            streaming: {
              ...state.message.streaming,
              content: state.message.streaming.content + content,
            },
          },
        })),

      finalizeStreaming: () => {
        const { message } = get();
        if (message.streaming.content) {
          const newMessage: Message = {
            id: generateId(),
            role: 'assistant',
            content: [{ type: 'text', text: message.streaming.content }],
            timestamp: Date.now(),
          };
          set((state) => ({
            message: {
              ...state.message,
              messages: [...state.message.messages, newMessage],
              streaming: { isActive: false, content: '', message: null },
            },
          }));
        }
      },

      setMessageLoading: (loading) =>
        set((state) => ({
          message: { ...state.message, loading },
        })),

      setMessageError: (error) =>
        set((state) => ({
          message: { ...state.message, error },
        })),

      // ===== Route Actions =====
      navigateRoute: (route) =>
        set((state) => ({
          route: {
            previous: state.route.current,
            current: route,
            transitioning: true,
          },
        })),

      setRouteTransitioning: (transitioning) =>
        set((state) => ({
          route: { ...state.route, transitioning },
        })),
    }))
  );

// Singleton store instance
let storeInstance: ReturnType<typeof createAppStore> | null = null;

export function getStore(): ReturnType<typeof createAppStore> {
  if (!storeInstance) {
    storeInstance = createAppStore();
  }
  return storeInstance;
}

export function resetStore(): void {
  storeInstance = null;
}

// Selector helpers for better performance
export function selectSession(store: ReturnType<typeof createAppStore>): SessionState {
  return store.getState().session;
}

export function selectConnection(store: ReturnType<typeof createAppStore>): ConnectionState {
  return store.getState().connection;
}

export function selectMessages(store: ReturnType<typeof createAppStore>): MessageState {
  return store.getState().message;
}

export function selectRoute(store: ReturnType<typeof createAppStore>): RouteState {
  return store.getState().route;
}

// Shorthand selectors for common access
export function selectCurrentSession(store: ReturnType<typeof createAppStore>) {
  return store.getState().session.current;
}

export function selectSessionList(store: ReturnType<typeof createAppStore>) {
  return store.getState().session.list;
}

export function selectConnectionStatus(store: ReturnType<typeof createAppStore>) {
  return store.getState().connection.status;
}

export function selectIsStreaming(store: ReturnType<typeof createAppStore>) {
  return store.getState().message.streaming.isActive;
}

export function selectCurrentRoute(store: ReturnType<typeof createAppStore>) {
  return store.getState().route.current;
}

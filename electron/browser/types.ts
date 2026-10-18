export type BrowserBounds = { x: number; y: number; width: number; height: number };
export type EmbeddedBrowserState = {
  id: string;
  workspaceTabId: string;
  scope: string;
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  error?: string;
  notice?: string;
  crashed?: boolean;
};
export type EmbeddedBrowserEvent = { kind: 'state'; state: EmbeddedBrowserState }
  | { kind: 'focus-address'; workspaceTabId: string }
  | { kind: 'popup'; url: string; scope: string; sourceTabId: string };
export type EmbeddedBrowserAPI = {
  ensure(input: { workspaceTabId: string; scope: string; identity: string }): Promise<EmbeddedBrowserState>;
  navigate(id: string, url: string): Promise<void>;
  command(id: string, command: 'back' | 'forward' | 'reload' | 'stop'): Promise<void>;
  present(id: string, bounds: BrowserBounds | null): Promise<void>;
  close(id: string): Promise<boolean>;
  release(): Promise<void>;
  onEvent(listener: (event: EmbeddedBrowserEvent) => void): () => void;
};

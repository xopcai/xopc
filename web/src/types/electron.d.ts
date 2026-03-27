export interface ElectronFileAPI {
  readFile(filePath: string): Promise<string>;
  writeFile(filePath: string, content: string): Promise<{ success: boolean }>;
  listDirectory(dirPath: string): Promise<
    Array<{ name: string; path: string; isDirectory: boolean }>
  >;
  openDirectory(): Promise<string | null>;
  watchFile(filePath: string, callback: (content: string) => void): void;
}

export interface ElectronSearchAPI {
  ripgrep(
    query: string,
    dirPath: string,
  ): Promise<
    Array<{
      filePath: string;
      lineNumber: number;
      lineContent: string;
      matchStart: number;
      matchEnd: number;
    }>
  >;
}

export interface ElectronAgentAPI {
  sendMessage(message: string, sessionKey: string): Promise<{ done: boolean; error?: string }>;
  onStream(callback: (chunk: string) => void): void;
}

export interface ElectronAPI {
  file: ElectronFileAPI;
  search: ElectronSearchAPI;
  agent: ElectronAgentAPI;
  platform: 'darwin' | 'win32' | 'linux';
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};

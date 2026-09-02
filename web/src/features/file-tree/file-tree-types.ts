export interface TreeEntry {
  /** Opaque managed-file id used for local desktop actions. */
  fileId: string;
  name: string;
  path: string;
  isDirectory: boolean;
  children?: TreeEntry[];
}

export type FileTreeAction =
  | 'preview'
  | 'download'
  | 'copyPath'
  | 'share'
  | 'openDefault'
  | 'openWith'
  | 'openWithApp'
  | 'revealInFolder'
  | 'trash';

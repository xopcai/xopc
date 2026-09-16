export type ReadAloudLiveActivityStatus = 'preparing' | 'playing' | 'paused';

export type ReadAloudLiveActivitySnapshot = {
  conversationId?: string;
  title: string;
  status: ReadAloudLiveActivityStatus;
  currentChunkIndex: number;
  chunkCount: number;
  rate: number;
};

export type ReadAloudLiveActivityProps = {
  title: string;
  detail: string;
  status: ReadAloudLiveActivityStatus;
  progress: number;
};

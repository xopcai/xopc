import type { LiveActivity } from 'expo-widgets';

import { ReadAloudLiveActivity } from '../../widgets/ReadAloudLiveActivity';
import type {
  ReadAloudLiveActivityProps,
  ReadAloudLiveActivitySnapshot,
} from './read-aloud-live-activity.types';

let activeActivity: LiveActivity<ReadAloudLiveActivityProps> | null = null;
let operation = Promise.resolve();
let generation = 0;
let lastProps = '';
let didWarn = false;

function propsFromSnapshot(snapshot: ReadAloudLiveActivitySnapshot): ReadAloudLiveActivityProps {
  const completedChunks = Math.min(snapshot.currentChunkIndex, snapshot.chunkCount);
  const detail = snapshot.status === 'preparing'
    ? `Preparing · ${snapshot.rate}×`
    : `${snapshot.currentChunkIndex + 1}/${snapshot.chunkCount} · ${snapshot.rate}×`;
  return {
    title: snapshot.title,
    detail,
    status: snapshot.status,
    progress: snapshot.chunkCount > 0 ? completedChunks / snapshot.chunkCount : 0,
  };
}

function destinationFromSnapshot(snapshot: ReadAloudLiveActivitySnapshot): string {
  return snapshot.sessionKey
    ? `xopc://chat/${encodeURIComponent(snapshot.sessionKey)}`
    : 'xopc:///';
}

function enqueue(task: () => Promise<void>): void {
  operation = operation.then(task).catch((error: unknown) => {
    if (didWarn) return;
    didWarn = true;
    console.warn('[ReadAloud] Live Activity unavailable', error);
  });
}

async function endExistingActivities(): Promise<void> {
  const instances = ReadAloudLiveActivity.getInstances();
  await Promise.allSettled(instances.map((instance) => instance.end('immediate')));
  activeActivity = null;
  lastProps = '';
}

export function startReadAloudLiveActivity(snapshot: ReadAloudLiveActivitySnapshot): void {
  const runGeneration = ++generation;
  const props = propsFromSnapshot(snapshot);
  const destination = destinationFromSnapshot(snapshot);
  enqueue(async () => {
    if (runGeneration !== generation) return;
    await endExistingActivities();
    if (runGeneration !== generation) return;
    activeActivity = ReadAloudLiveActivity.start(props, destination);
    lastProps = JSON.stringify(props);
  });
}

export function updateReadAloudLiveActivity(snapshot: ReadAloudLiveActivitySnapshot): void {
  const runGeneration = generation;
  const props = propsFromSnapshot(snapshot);
  const serialized = JSON.stringify(props);
  enqueue(async () => {
    if (runGeneration !== generation || !activeActivity || serialized === lastProps) return;
    await activeActivity.update(props);
    lastProps = serialized;
  });
}

export function endReadAloudLiveActivity(): void {
  ++generation;
  enqueue(endExistingActivities);
}

export function clearStaleReadAloudLiveActivities(): void {
  endReadAloudLiveActivity();
}

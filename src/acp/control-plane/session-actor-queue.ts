/**
 * Session Actor Queue
 * 
 * Provides serialized access to session operations to prevent race conditions.
 */

type ActorState = {
  pending: Array<() => Promise<void>>;
  running: boolean;
};

export class SessionActorQueue {
  private readonly actors = new Map<string, ActorState>();

  /** Run an operation in the actor queue */
  async run<T>(actorKey: string, op: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const state = this.getOrCreateActor(actorKey);
      
      const task = async () => {
        try {
          const result = await op();
          resolve(result);
        } catch (error) {
          reject(error);
        } finally {
          this.dequeue(actorKey);
        }
      };
      
      state.pending.push(task);
      this.processQueue(actorKey);
    });
  }

  /** Get total pending count across all actors */
  getTotalPendingCount(): number {
    let total = 0;
    for (const state of this.actors.values()) {
      total += state.pending.length;
    }
    return total;
  }

  /** Get tail map for testing */
  getTailMapForTesting(): Map<string, ActorState> {
    return this.actors;
  }

  private getOrCreateActor(key: string): ActorState {
    let state = this.actors.get(key);
    if (!state) {
      state = { pending: [], running: false };
      this.actors.set(key, state);
    }
    return state;
  }

  private dequeue(actorKey: string): void {
    const state = this.actors.get(actorKey);
    if (!state) return;
    
    state.running = false;
    
    if (state.pending.length > 0) {
      const next = state.pending.shift();
      if (next) {
        state.running = true;
        void next();
      }
    }
    
    // Clean up empty actors
    if (!state.running && state.pending.length === 0) {
      this.actors.delete(actorKey);
    }
  }

  private processQueue(actorKey: string): void {
    const state = this.actors.get(actorKey);
    if (!state || state.running) return;
    
    if (state.pending.length > 0) {
      const next = state.pending.shift();
      if (next) {
        state.running = true;
        void next();
      }
    }
  }
}
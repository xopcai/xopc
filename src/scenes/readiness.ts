/** A temporary absence of synchronized evidence, not a model execution failure. */
export class SceneSourceNotReady extends Error {
  constructor() { super('Scene source is stale or not synchronized yet'); }
}

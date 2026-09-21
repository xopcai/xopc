import type { BrowserControlResult, BrowserObservation } from '@xopcai/browser-control-contract';

/** Leave room for the endpoint and realtime envelopes below the 256 KiB frame limit. */
export const MAX_BROWSER_CONTROL_RESULT_BYTES = 224 * 1024;

function utf8Bytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function observationOf(result: BrowserControlResult): BrowserObservation | undefined {
  return result.ok ? result.receipt.observation : result.error.observation;
}

function withObservation(
  result: BrowserControlResult,
  observation: BrowserObservation,
): BrowserControlResult {
  return result.ok
    ? { ...result, receipt: { ...result.receipt, observation } }
    : { ...result, error: { ...result.error, observation } };
}

function truncatedObservation(
  observation: BrowserObservation,
  options: {
    nodeCount: number;
    visualOmitted: boolean;
    changesOmitted: boolean;
  },
): BrowserObservation {
  return {
    ...observation,
    nodes: observation.nodes.slice(0, options.nodeCount),
    ...(options.visualOmitted ? { visual: undefined } : {}),
    ...(options.changesOmitted
      ? { changes: { added: [], changed: [], removed: [] } }
      : {}),
    truncation: {
      omittedNodeCount: observation.nodes.length - options.nodeCount,
      visualOmitted: options.visualOmitted,
      changesOmitted: options.changesOmitted,
    },
  };
}

/**
 * Keep browser-control results inside the realtime frame budget. Visual data and
 * change lists are redundant with the semantic node snapshot, so they are
 * discarded before the snapshot itself is shortened.
 */
export function fitBrowserControlResultToFrame(
  result: BrowserControlResult,
  maxBytes = MAX_BROWSER_CONTROL_RESULT_BYTES,
): BrowserControlResult {
  if (utf8Bytes(result) <= maxBytes) return result;
  const observation = observationOf(result);
  if (!observation) return result;

  const withoutVisual = withObservation(result, truncatedObservation(observation, {
    nodeCount: observation.nodes.length,
    visualOmitted: Boolean(observation.visual),
    changesOmitted: false,
  }));
  if (utf8Bytes(withoutVisual) <= maxBytes) return withoutVisual;

  const withoutChanges = withObservation(result, truncatedObservation(observation, {
    nodeCount: observation.nodes.length,
    visualOmitted: Boolean(observation.visual),
    changesOmitted: true,
  }));
  if (utf8Bytes(withoutChanges) <= maxBytes) return withoutChanges;

  let low = 0;
  let high = observation.nodes.length;
  let fitted = withObservation(result, truncatedObservation(observation, {
    nodeCount: 0,
    visualOmitted: Boolean(observation.visual),
    changesOmitted: true,
  }));
  while (low <= high) {
    const nodeCount = Math.floor((low + high) / 2);
    const candidate = withObservation(result, truncatedObservation(observation, {
      nodeCount,
      visualOmitted: Boolean(observation.visual),
      changesOmitted: true,
    }));
    if (utf8Bytes(candidate) <= maxBytes) {
      fitted = candidate;
      low = nodeCount + 1;
    } else {
      high = nodeCount - 1;
    }
  }
  return fitted;
}

export interface RuntimeDispatchRequest {
  id: number;
  method: string;
}

export function createRuntimeDispatcher<T extends RuntimeDispatchRequest>(options: {
  execute: (request: T) => Promise<unknown>;
  sendResult: (request: T, result: unknown) => void;
  sendError: (request: T, error: unknown) => void;
}): (request: T) => void {
  let queue = Promise.resolve();
  const run = async (request: T) => {
    try {
      options.sendResult(request, await options.execute(request));
    } catch (error) {
      options.sendError(request, error);
    }
  };

  return (request) => {
    if (request.method === 'health') {
      void run(request);
      return;
    }
    queue = queue.then(() => run(request));
  };
}

/**
 * Test-only: runs a blob worker in process.
 *
 * It assembles exactly the source WorkerFactory hands to `new Worker(...)` —
 * the library factories assigned onto the worker scope, then the worker body —
 * so tests exercise the shipping worker code and the injection mechanism
 * rather than a re-implementation of either.
 *
 * `sync` delivers messages immediately (handy for straight-line assertions);
 * otherwise delivery is deferred, and `latency` models a slow reply.
 */
export function createInProcessWorker(
  workerFunction,
  libFunctions = [],
  { sync = false, latency = () => 0 } = {}
) {
  const source = `${libFunctions
    .map((lib) => `Object.assign(self, (${lib.toString()})());`)
    .join("\n")}\n(${workerFunction.toString()})()`;

  const worker = {
    onmessage: null,
    dead: false,
    postMessage(message) {
      if (worker.dead) return;
      deliver(() => worker.inbound({ data: message }));
    },
    terminate() {
      worker.dead = true;
    },
  };

  const deliver = (run) => {
    if (sync) run();
    else setTimeout(run, 0);
  };

  const scope = {
    addEventListener: (type, handler) => {
      worker.inbound = handler;
    },
    postMessage: (message) => {
      if (worker.dead) return;
      const delay = latency(message);
      const run = () => worker.onmessage && worker.onmessage({ data: message });
      if (sync && !delay) run();
      else setTimeout(run, delay);
    },
  };

  // eslint-disable-next-line no-new-func
  new Function("self", source)(scope);
  return worker;
}

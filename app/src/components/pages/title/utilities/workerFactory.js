/**
 * Builds a blob-backed Worker out of a plain function, so worker code can live
 * in a normal module without a separate bundler entry point.
 *
 * `libFunctions` are factory functions (see ./bigFloat) that return an object of
 * helpers; each returned property is assigned onto the worker's global scope
 * before the worker body runs, which is how shared code crosses the blob
 * boundary (the stringified body cannot carry its imports with it).
 */
export default class WorkerFactory {
  constructor(workerFunction, libFunctions = []) {
    const libCode = libFunctions
      .map((lib) => `Object.assign(self, (${lib.toString()})());`)
      .join("\n");
    const workerBlob = new Blob([`${libCode}\n(${workerFunction.toString()})()`]);
    return new Worker(URL.createObjectURL(workerBlob));
  }
}

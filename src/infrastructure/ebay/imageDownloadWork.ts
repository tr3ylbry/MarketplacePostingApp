// Internal lifecycle only; no runtime transport factory or policy override.
export interface ImageDownloadWork<T> { ready: Promise<T>; settled: Promise<void>; abort(): void }
export function downloadDeferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  // A resource may fail before its caller reaches the ready await.
  void promise.catch(() => {});
  return { promise, resolve, reject };
}

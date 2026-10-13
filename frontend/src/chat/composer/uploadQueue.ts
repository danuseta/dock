export class UploadRefused extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export const UPLOAD_CONCURRENCY = 2;
export const BUSY_RETRY_MS = 1500;

export function createUploadQueue(limit: number = UPLOAD_CONCURRENCY) {
  let active = 0;
  const waiting: Array<() => void> = [];
  const next = () => {
    while (active < limit && waiting.length > 0) {
      active += 1;
      waiting.shift()?.();
    }
  };
  return <T>(task: () => Promise<T>): Promise<T> => new Promise<T>((resolve, reject) => {
    waiting.push(() => {
      Promise.resolve().then(task).then(resolve, reject).finally(() => {
        active -= 1;
        next();
      });
    });
    next();
  });
}

export async function retryOnce<T>(
  attempt: () => Promise<T>,
  shouldRetry: (error: unknown) => boolean,
  pause: (ms: number) => Promise<void>,
  signal: AbortSignal,
  delayMs: number = BUSY_RETRY_MS,
): Promise<T> {
  try {
    return await attempt();
  } catch (error) {
    if (!shouldRetry(error)) throw error;
    await pause(delayMs);
    if (signal.aborted) throw new DOMException('Upload cancelled', 'AbortError');
    return attempt();
  }
}

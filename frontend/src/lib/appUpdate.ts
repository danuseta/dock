const TRIED_KEY = 'dock-update-tried';

/** The build this page is running: the hashed name of its entry script. Null in development, where nothing is hashed. */
export function runningBuild(): string | null {
  return document.querySelector('script[type="module"][src*="/assets/index-"]')?.getAttribute('src') ?? null;
}

/** The build the server serves now. `/health` is never touched by the service worker, so this is always a live answer. The built app and its API share an origin. */
export async function serverBuild(): Promise<string | null> {
  const response = await fetch('/health', { cache: 'no-store' });
  return (await response.json()).build ?? null;
}

export type UpdateStep = 'none' | 'reload' | 'offer';

/**
 * What to do about a newer build on the server. Reloading is free when nothing is typed, so it just happens. With
 * text in a box the owner is offered the update instead. A build that was already reloaded for and is still not the
 * one running is offered too, never reloaded for twice.
 */
export function updateStep(running: string | null, server: string | null, typing: boolean, tried: string | null): UpdateStep {
  if (!running || !server || running === server) return 'none';
  return typing || tried === server ? 'offer' : 'reload';
}

const typing = () => [...document.querySelectorAll('textarea')].some((box) => box.value.trim() !== '');

/** Checks once; resolves true when the caller should show the "new version" offer. */
export async function checkForUpdate(): Promise<boolean> {
  const running = runningBuild();
  if (!running) return false;
  const server = await serverBuild().catch(() => null);
  const step = updateStep(running, server, typing(), sessionStorage.getItem(TRIED_KEY));
  if (step === 'reload') applyUpdate(server);
  return step === 'offer';
}

export function applyUpdate(server: string | null = null): void {
  if (server) sessionStorage.setItem(TRIED_KEY, server);
  window.location.reload();
}

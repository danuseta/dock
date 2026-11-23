const TRIED_KEY = 'dock-update-tried';

/** How often an open, visible page asks the server for its build, so a deploy lands without leaving the tab. */
export const UPDATE_CHECK_MS = 60_000;

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

/** How long after a file picker opens a newer build waits, so closing the picker does not reload away the upload. */
export const PICKING_MS = 120_000;
let pickedAt = 0;
if (typeof document !== 'undefined') {
  document.addEventListener('click', (event) => {
    const target = event.target as Element | null;
    const input = target?.closest?.('input[type="file"]') ?? (target?.closest?.('label') as HTMLLabelElement | null)?.control ?? null;
    if (input instanceof HTMLInputElement && input.type === 'file') pickedAt = Date.now();
  }, true);
}

/** A file picker opened in the last two minutes, or a picked file not sent yet: a reload would drop it. */
export const choosingFile = (now = Date.now(), opened = pickedAt) => now - opened < PICKING_MS
  || (typeof document !== 'undefined' && [...document.querySelectorAll<HTMLInputElement>('input[type="file"]')].some((input) => (input.files?.length ?? 0) > 0));

/** Text in a box on screen, an open dialog whose form a reload would throw away, or a file being picked. A hidden prefilled box does not count. */
const typing = () => [...document.querySelectorAll('textarea')].some((box) => box.getClientRects().length > 0 && box.value.trim() !== '') || document.querySelector('[role="dialog"]') !== null || choosingFile();

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

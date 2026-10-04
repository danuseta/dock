// Rules and constants ported from pixtuoid (MIT, (c) 2026 Ivan Wang):
// state/mod.rs, state/reducer/mod.rs, pose/pure.rs and source/decoder.rs,
// rewritten from Rust. See frontend/public/third-party-notices.txt.

export const ACTIVE_GRACE_WINDOW = 1.5;
export const THINKING_WINDOW_SECS = 20;
export const STALE_ACTIVE_TIMEOUT = 600;
export const STALE_IDLE_TIMEOUT = 1800;
export const STALE_WAITING_TIMEOUT = 3600;

export type Activity = 'IDLE' | 'ACTIVE' | 'WAITING';
export type Pose = 'SeatedTyping' | 'SeatedWaiting' | 'SeatedThinking' | 'Asleep';
export type HookEvent = 'PreToolUse' | 'PostToolUse' | 'Stop' | 'Notification' | 'PermissionRequest';

/** Times are seconds on one monotonic-enough clock (see `clock`). */
export interface ActivitySlot {
  state: Activity;
  detail: string | null;
  lastEventAt: number;
  endedAt: number | null;
}

export const clock = () => Date.now() / 1000;

export function applyHook(slot: ActivitySlot, event: HookEvent, now: number, detail?: string): void {
  if (event === 'PreToolUse') Object.assign(slot, { state: 'ACTIVE', detail: detail || 'tool', endedAt: null });
  else if (event === 'PostToolUse' || event === 'Stop') slot.endedAt = now;
  else if (event === 'Notification') Object.assign(slot, { state: 'WAITING', detail: detail || 'waiting', endedAt: null });
  else Object.assign(slot, { state: 'WAITING', detail: 'permission', endedAt: null });
  slot.lastEventAt = now;
}

export function tickActivity(slot: ActivitySlot, now: number): void {
  if (slot.state === 'ACTIVE' && slot.endedAt != null && now - slot.endedAt >= ACTIVE_GRACE_WINDOW) {
    slot.state = 'IDLE';
    slot.detail = null;
    slot.endedAt = null;
  }
}

export function poseOf(slot: ActivitySlot, now: number): Pose {
  if (slot.state === 'ACTIVE') return 'SeatedTyping';
  if (slot.state === 'WAITING') return 'SeatedWaiting';
  return now - slot.lastEventAt < THINKING_WINDOW_SECS ? 'SeatedThinking' : 'Asleep';
}

export function isStale(slot: ActivitySlot, now: number): boolean {
  const age = now - slot.lastEventAt;
  if (slot.state === 'ACTIVE') return age > STALE_ACTIVE_TIMEOUT;
  if (slot.state === 'WAITING') return age > STALE_WAITING_TIMEOUT;
  return age > STALE_IDLE_TIMEOUT;
}

/**
 * The server reports ages rather than timestamps, so the laptop, the server
 * and this browser never have to agree on the time of day.
 */
export function slotFromServer(
  run: { activity: string; activityDetail?: string | null; idleSeconds: number; endedSeconds?: number | null },
  now: number,
): ActivitySlot {
  return {
    state: run.activity === 'ACTIVE' || run.activity === 'WAITING' ? run.activity : 'IDLE',
    detail: run.activityDetail ?? null,
    lastEventAt: now - run.idleSeconds,
    endedAt: run.endedSeconds == null ? null : now - run.endedSeconds,
  };
}

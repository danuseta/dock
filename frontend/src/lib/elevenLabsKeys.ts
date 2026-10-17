export interface ElevenLabsKeyRow { name: string; masked: string; parkedUntil?: string | null; current: boolean }

/** What a key is doing now: in use, parked until a time, or ready. */
export const keyState = (key: ElevenLabsKeyRow) => (
  key.parkedUntil ? `parked until ${new Date(key.parkedUntil).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}` : key.current ? 'in use' : 'ready'
);

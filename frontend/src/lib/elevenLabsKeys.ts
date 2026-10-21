export interface ElevenLabsKeyRow { name: string; masked: string; parkedUntil?: string | null; current: boolean }

/** What a key is doing now: in use, parked until a time, or ready. */
export const keyState = (key: ElevenLabsKeyRow) => (
  key.parkedUntil ? `parked until ${new Date(key.parkedUntil).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}` : key.current ? 'in use' : 'ready'
);

export interface ElevenLabsQuotaRow { name: string; characterCount?: number | null; characterLimit?: number | null; resetsAt?: string | null; hidden: boolean; error?: string | null }

/** Characters left of the limit, with the reset date when ElevenLabs gives one. */
export const quotaText = (quota: { characterCount: number; characterLimit: number; resetsAt?: string | null }) => {
  const left = Math.max(0, quota.characterLimit - quota.characterCount);
  const resets = quota.resetsAt ? ` · resets ${new Date(quota.resetsAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : '';
  return `${left.toLocaleString('en-US')} of ${quota.characterLimit.toLocaleString('en-US')} characters left${resets}`;
};

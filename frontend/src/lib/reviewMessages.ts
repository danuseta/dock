export const DEFAULT_REVIEW_SKILL = 'review-message';
export const DEFAULT_REVIEW_POST_TEMPLATE = 'mas {{author}}, {{status}}. {{lgtm}} catatan: {{notes}}';
export const DEFAULT_REVIEW_REPLY_TEMPLATE = 'mas {{author}}, {{status}} di {{sha}}. {{notes}}';
export const SKILL_NAME = /^[a-z0-9][a-z0-9:_-]{0,60}$/;
export const MAX_TEMPLATE_CHARS = 2000;

export type MessageKind = 'post' | 'reply';

export const MESSAGE_KEYS = {
  post: { format: 'reviewPostFormat', skill: 'reviewPostSkill', template: 'reviewPostTemplate' },
  reply: { format: 'reviewReplyFormat', skill: 'reviewReplySkill', template: 'reviewReplyTemplate' },
} as const;

export const MESSAGE_FORMATS: Record<MessageKind, Array<{ value: string; label: string }>> = {
  post: [{ value: 'skill', label: 'Skill' }, { value: 'template', label: 'DOCK template' }],
  reply: [{ value: 'builtin', label: 'DOCK default' }, { value: 'skill', label: 'Skill' }, { value: 'template', label: 'DOCK template' }],
};

export const TEMPLATE_PLACEHOLDERS: Record<MessageKind, string[]> = {
  post: ['author', 'ticket', 'round', 'sha', 'pr', 'status', 'lgtm', 'blockers', 'notes'],
  reply: ['author', 'ticket', 'round', 'sha', 'pr', 'status', 'notes'],
};

export const MESSAGE_MARKER: Record<MessageKind, string> = {
  post: 'DOCK-REVIEW on it by <@your Discord id> · round 2 · @ b71e0d4',
  reply: 'DOCK-FIX round 2 · head b71e0d4',
};

export const REVIEW_NUMBERS = {
  reviewPostDelayMinutes: { fallback: 2, min: 0, max: 60, label: 'Post delay' },
  reviewReReviewWaitMinutes: { fallback: 10, min: 0, max: 240, label: 'Re-review wait' },
  reviewMaxRounds: { fallback: 3, min: 1, max: 10, label: 'Max rounds' },
} as const;

export const reviewNumberErrors = (values: Record<string, string>) => Object.entries(REVIEW_NUMBERS).flatMap(([key, range]) => {
  const number = Number(values[key]);
  return values[key].trim() !== '' && Number.isInteger(number) && number >= range.min && number <= range.max ? [] : [`${range.label} is a whole number from ${range.min} to ${range.max}.`];
});

export const reviewMessageErrors = (values: Record<string, string>) => (['post', 'reply'] as const).flatMap((kind) => {
  const keys = MESSAGE_KEYS[kind];
  const name = kind === 'post' ? 'review post' : 'review reply';
  if (values[keys.format] === 'skill' && !SKILL_NAME.test(values[keys.skill])) return [`Pick the skill for the ${name}.`];
  if (values[keys.format] === 'template' && (values[keys.template].trim() === '' || values[keys.template].length > MAX_TEMPLATE_CHARS)) return [`The ${name} template needs 1 to ${MAX_TEMPLATE_CHARS} characters.`];
  return [];
});

const SAMPLE: Record<string, string> = {
  author: 'rizky', ticket: 'QRD-1529', round: '2', sha: 'b71e0d4', pr: '<https://github.com/qonekid/ms-admin-worker-backend/pull/969>',
  status: 'gak ada blocker', lgtm: 'lgtm', blockers: '', notes: '1) empty state sekarang "Belum ada data" sesuai ac 2',
};

const REPLY_SAMPLE = 'mas rizky, 1) empty state: fixed di b71e0d4. 2) retry count: tidak diubah karena sudah sesuai ac 3.';
const SKILL_SAMPLE = 'The review session writes this message with the skill, then wraps it for DOCK to post.';

/** The message a format gives for a sample round, without the marker line. */
export function previewMessage(kind: MessageKind, format: string, template: string): string {
  if (format === 'builtin') return REPLY_SAMPLE;
  if (format === 'skill') return SKILL_SAMPLE;
  const sample = kind === 'reply' ? { ...SAMPLE, status: '2 temuan difix', lgtm: '', notes: 'empty state sudah "Belum ada data".' } : SAMPLE;
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name: string) => sample[name] ?? '').split('\n').map((line) => line.replace(/[ \t]{2,}/g, ' ').trim()).join('\n').trim();
}

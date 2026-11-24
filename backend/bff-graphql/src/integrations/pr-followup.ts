import type { PushMessage } from './push';

export const DEFAULT_PR_TAG_TEMPLATE = '@{{role}} {{slots}} mas mas, thanks';
export const DEFAULT_PR_TAG_ROLE = 'ITteam';
export const PR_TAG_KEYS = { enabled: 'prTagEnabled', template: 'prTagTemplate', role: 'prTagRole' } as const;
export const MAX_PR_TAG_TEMPLATE_LENGTH = 1_000;
export const MAX_PR_TAG_ROLE_LENGTH = 100;
const MAX_DISCORD_MESSAGE_LENGTH = 2_000;
const TAG_FIELDS = new Set(['role', 'slots']);
const ROLE_CACHE_MS = 10 * 60_000;

export interface AllowedMentions { parse: string[]; roles?: string[] }

export interface PrFollowUpDeps {
  /** The id of the server role with this name; null when the bot is not set up or the server has no such role. */
  roleId(name: string): Promise<string | null>;
  /** Sends one message to the thread of the post. */
  post(content: string, allowedMentions: AllowedMentions): Promise<unknown>;
  push(message: PushMessage): Promise<unknown>;
}

export interface PrFollowUpInput {
  settings: Record<string, unknown>;
  tickets: Array<{ key: string; issueType?: string | null }>;
  notes?: string | null;
}

/** The saved tag template, checked: at most 1000 characters and only the {{role}} and {{slots}} fields. */
export function normalizePrTagTemplate(value?: string | null): string {
  const template = value?.trim() || DEFAULT_PR_TAG_TEMPLATE;
  if (template.length > MAX_PR_TAG_TEMPLATE_LENGTH) throw new Error('Reviewer tag template is too long');
  for (const field of template.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)) {
    if (!TAG_FIELDS.has(field[1])) throw new Error(`Unsupported reviewer tag field: ${field[1]}`);
  }
  return template;
}

/** The role name without a leading @. */
export const normalizePrTagRole = (value?: string | null) => value?.trim().replace(/^@+/, '').trim() || DEFAULT_PR_TAG_ROLE;

/** "-1" when every posted ticket is a Bug, "-2" otherwise; null when Jira gave no issue type for one of them. */
export function slotsFor(issueTypes: Array<string | null | undefined>): '-1' | '-2' | null {
  if (issueTypes.some((type) => typeof type !== 'string' || !type.trim())) return null;
  return issueTypes.length > 0 && issueTypes.every((type) => type?.trim().toLowerCase() === 'bug') ? '-1' : '-2';
}

export function prTagMessage(template: string, role: string, slots: string): string {
  return template.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_match, field: string) => (field === 'role' ? role : field === 'slots' ? slots : ''));
}

/** Every @role in the text becomes the mention Discord pings. */
export const withRolePing = (text: string, role: string, roleId: string) => text.split(`@${role}`).join(`<@&${roleId}>`);

export const notesMessage = (notes: string) => `Notes :\n${notes}`.slice(0, MAX_DISCORD_MESSAGE_LENGTH);

const ticketUrl = (key: string) => `/detail/${encodeURIComponent(key)}`;

/**
 * The messages DOCK sends in the thread of a pull request post, right after it: the notes when there are any, then
 * the reviewer tag from the saved template unless the tag is turned off. A failure never reaches the caller; the
 * owner is told instead, and told too when the tag went out with -2 for want of an issue type or without a ping.
 */
export async function sendPrFollowUps(deps: PrFollowUpDeps, input: PrFollowUpInput): Promise<void> {
  const key = input.tickets[0]?.key ?? 'PR';
  const role = normalizePrTagRole(typeof input.settings[PR_TAG_KEYS.role] === 'string' ? input.settings[PR_TAG_KEYS.role] as string : null);
  const tagOn = input.settings[PR_TAG_KEYS.enabled] !== 'false';
  const notes = input.notes?.trim() ?? '';
  const notify = (message: PushMessage) => deps.push(message).catch(() => undefined);
  try {
    let tag: { content: string; allowedMentions: AllowedMentions } | null = null;
    if (tagOn) {
      let template = DEFAULT_PR_TAG_TEMPLATE;
      try {
        template = normalizePrTagTemplate(typeof input.settings[PR_TAG_KEYS.template] === 'string' ? input.settings[PR_TAG_KEYS.template] as string : null);
      } catch {
        template = DEFAULT_PR_TAG_TEMPLATE;
      }
      const slots = slotsFor(input.tickets.map((ticket) => ticket.issueType));
      if (!slots) {
        const unread = input.tickets.filter((ticket) => !ticket.issueType?.trim()).map((ticket) => ticket.key).join(', ');
        await notify({ title: `${key}: tagged ${role} with -2`, body: `Jira gave no issue type for ${unread}, so DOCK asked for two reviewers.`, url: ticketUrl(key), tag: `pr-tag-slots-${key}` });
      }
      const text = prTagMessage(template, role, slots ?? '-2');
      const roleId = text.includes(`@${role}`) ? await deps.roleId(role).catch(() => null) : null;
      if (text.includes(`@${role}`) && !roleId) {
        await notify({ title: `${key}: ${role} was not pinged`, body: `DOCK could not find the role ${role} with the Discord bot, so the tag went out as plain text. Tag it by hand.`, url: ticketUrl(key), tag: `pr-tag-role-${key}` });
      }
      tag = roleId
        ? { content: withRolePing(text, role, roleId), allowedMentions: { parse: [], roles: [roleId] } }
        : { content: text, allowedMentions: { parse: [] } };
    }
    if (notes) await deps.post(notesMessage(notes), { parse: [] });
    if (tag) await deps.post(tag.content, tag.allowedMentions);
  } catch (error) {
    console.error(`[Broadcast] follow-up of ${key} failed:`, error instanceof Error ? error.message : 'unknown error');
    await notify(tagOn
      ? { title: `Tag ${role} failed, type it by hand`, body: `The pull request post of ${key} is up, but DOCK could not send the reviewer tag to its thread.`, url: ticketUrl(key), tag: `pr-tag-failed-${key}` }
      : { title: `Notes of ${key} failed, type them by hand`, body: `The pull request post of ${key} is up, but DOCK could not send the notes to its thread.`, url: ticketUrl(key), tag: `pr-tag-failed-${key}` });
  }
}

export interface RoleLookupDeps {
  /** The bot token and the server id, or null when one is missing. */
  config(): Promise<{ token: string; guild: string } | null>;
  request(path: string, token: string): Promise<{ status: number; body: unknown }>;
  now(): number;
}

/** Finds a server role by name with the DOCK bot; the server's roles are kept for ten minutes. */
export class RoleLookup {
  private cached: { guild: string; at: number; roles: Array<{ id: string; name: string }> } | null = null;

  constructor(private readonly deps: RoleLookupDeps, private readonly ttlMs = ROLE_CACHE_MS) {}

  async id(name: string): Promise<string | null> {
    const config = await this.deps.config();
    if (!config) return null;
    if (!this.cached || this.cached.guild !== config.guild || this.deps.now() - this.cached.at > this.ttlMs) {
      const response = await this.deps.request(`/guilds/${encodeURIComponent(config.guild)}/roles`, config.token);
      if (response.status < 200 || response.status >= 300 || !Array.isArray(response.body)) return null;
      const roles = (response.body as Array<{ id?: unknown; name?: unknown }>)
        .filter((role): role is { id: string; name: string } => typeof role?.id === 'string' && typeof role?.name === 'string');
      this.cached = { guild: config.guild, at: this.deps.now(), roles };
    }
    const wanted = name.trim();
    const role = this.cached.roles.find((item) => item.name === wanted)
      ?? this.cached.roles.find((item) => item.name.toLowerCase() === wanted.toLowerCase());
    return role?.id ?? null;
  }
}

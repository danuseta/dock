import { DiscordAPI } from '../datasources/DiscordAPI';
import { GitHubAPI } from '../datasources/GitHubAPI';
import { JiraAPI } from '../datasources/JiraAPI';
import { StorageAPI } from '../datasources/StorageAPI';
import { StorageService } from '../storage/service';
import { moveToReview } from './broadcast-review';
import { orchestratorService } from './orchestrator';

export interface BroadcastInput { ticketKey: string; customMessage?: string; threadId?: string; threadName?: string }

export interface BroadcastDeps {
  relation(key: string): Promise<{ ticketKeys: string[]; primaryKey?: string | null }>;
  ticket(key: string): Promise<any | null>;
  pullRequests(key: string): Promise<any[]>;
  demoLink(key: string): Promise<{ url: string } | null>;
  settings(): Promise<Record<string, any>>;
  send(payload: any): Promise<boolean>;
  move(key: string, status: string): Promise<boolean>;
}

const isPresent = <T>(value: T | null | undefined): value is T => value != null;

/** The Discord broadcast of a ticket and the tickets grouped with it; tickets before review move to PR Review once it is sent. */
export async function sendBroadcast(deps: BroadcastDeps, { ticketKey, customMessage, threadId, threadName }: BroadcastInput): Promise<boolean> {
  const relation = await deps.relation(ticketKey);
  const tickets = (await Promise.all(relation.ticketKeys.map((key) => deps.ticket(key)))).filter(isPresent);
  if (tickets.length === 0) return false;

  const [pullRequestGroups, demoLinks] = await Promise.all([
    Promise.all(tickets.map((ticket) => deps.pullRequests(ticket.key))),
    Promise.all(tickets.map((ticket) => deps.demoLink(ticket.key))),
  ]);
  const prs = [...new Map(pullRequestGroups.flat().map((pr: any) => [pr.url || pr.id, pr])).values()];
  const primaryTicket = tickets.find((ticket) => ticket.key === relation.primaryKey) || tickets[0];
  if (!primaryTicket) return false;
  const settings = await deps.settings();
  const demoEntries = demoLinks
    .map((demoLink, index) => ({ key: tickets[index]?.key, url: demoLink?.url }))
    .filter((entry): entry is { key: string; url: string } => Boolean(entry.key && entry.url));
  const uniqueDemoUrls = [...new Set(demoEntries.map((entry) => entry.url))];

  const payload = {
    ticket: {
      key: primaryTicket.key,
      title: primaryTicket.title,
      url: primaryTicket.url || `https://jira.example.com/browse/${primaryTicket.key}`
    },
    relatedTickets: tickets.map((ticket) => ({
      key: ticket.key,
      title: ticket.title,
      url: ticket.url || `https://jira.example.com/browse/${ticket.key}`,
    })),
    prs,
    demoUrl: (uniqueDemoUrls.length === 1
      ? `- **${tickets.map((ticket) => ticket.key).join(' + ')}:** ${uniqueDemoUrls[0]}`
      : demoEntries.map((entry) => `- **${entry.key}:** ${entry.url}`).join('\n')) || undefined,
    webhookUrl: settings.discordWebhookUrl,
    messageTemplate: settings.discordMessageTemplate,
    customMessage,
    threadId,
    threadName
  };

  const sent = await deps.send(payload);
  if (sent) {
    const notMoved = await moveToReview(tickets, deps.move);
    if (notMoved.length) console.warn(`[Broadcast] Jira did not move ${notMoved.join(', ')} to PR Review`);
  }
  return sent;
}

export interface AutoBroadcastDeps {
  /** True once the automatic broadcast of the ticket was posted. */
  posted(key: string): Promise<boolean>;
  markPosted(key: string, at: Date): Promise<unknown>;
  hasDemo(key: string): Promise<boolean>;
  /** True when the ticket has a pull request open for review. */
  hasOpenPullRequest(key: string): Promise<boolean>;
  broadcast(key: string): Promise<boolean>;
  event(key: string, kind: string, detail: string | null): Promise<unknown>;
  now(): Date;
}

export type AutoBroadcastResult = 'posted' | 'already' | 'waiting' | 'failed';

/**
 * Posts the Discord broadcast of a ticket on its own, once per ticket, as soon as it has both a demo video and an
 * open pull request: after the video upload, or after a ledger that names a pull request when the video came first.
 * A failure goes to the log and the ticket's event list; the next upload or ledger tries again.
 */
export class AutoBroadcast {
  private readonly running = new Set<string>();

  constructor(private readonly deps: AutoBroadcastDeps) {}

  async afterDemoVideo(key: string): Promise<AutoBroadcastResult> {
    return this.post(key, 'demo video');
  }

  /** A ledger that names a pull request, for a ticket whose demo video is already up. */
  async afterLedger(run: { key: string; prBe?: string | null; prFe?: string | null }): Promise<AutoBroadcastResult> {
    if (!run.prBe && !run.prFe) return 'waiting';
    if (await this.deps.posted(run.key) || !(await this.deps.hasDemo(run.key))) return 'waiting';
    return this.post(run.key, 'pull request');
  }

  private async post(key: string, after: string): Promise<AutoBroadcastResult> {
    if (this.running.has(key)) return 'already';
    this.running.add(key);
    try {
      if (await this.deps.posted(key)) return 'already';
      if (!(await this.deps.hasOpenPullRequest(key))) return 'waiting';
      let detail = 'Discord did not accept the broadcast (check the webhook in Settings)';
      let sent = false;
      try {
        sent = await this.deps.broadcast(key);
      } catch (error) {
        detail = error instanceof Error ? error.message : 'unknown error';
      }
      if (!sent) {
        console.error(`[Broadcast] automatic broadcast of ${key} failed:`, detail);
        await this.deps.event(key, 'BROADCAST_FAILED', detail).catch(() => undefined);
        return 'failed';
      }
      await this.deps.markPosted(key, this.deps.now());
      await this.deps.event(key, 'BROADCAST', `posted to Discord after the ${after}`).catch(() => undefined);
      return 'posted';
    } finally {
      this.running.delete(key);
    }
  }
}

const AUTO_BROADCAST_CACHE = 'auto-broadcast';
const storage = new StorageService();
const storageAPI = new StorageAPI();
const jiraAPI = new JiraAPI();
const githubAPI = new GitHubAPI();
const discordAPI = new DiscordAPI();

export const broadcastDeps: BroadcastDeps = {
  relation: (key) => storageAPI.getTicketRelationGroup(key),
  ticket: (key) => jiraAPI.getTicket(key),
  pullRequests: (key) => githubAPI.getPullRequestsForTicket(key),
  demoLink: (key) => storageAPI.getDemoLink(key),
  settings: () => storageAPI.getSettings(),
  send: (payload) => discordAPI.sendSummary(payload),
  move: (key, status) => jiraAPI.transitionTicket(key, status),
};

export const autoBroadcast = new AutoBroadcast({
  posted: async (key) => Boolean(await storage.getCache(AUTO_BROADCAST_CACHE, key)),
  markPosted: (key, at) => storage.upsertCache(AUTO_BROADCAST_CACHE, key, { at: at.toISOString() }, 0),
  hasDemo: async (key) => Boolean(await storageAPI.getDemoLink(key)),
  // A draft pull request is not up for review yet, so it does not count.
  hasOpenPullRequest: async (key) => (await githubAPI.getPullRequestsForTicket(key)).some((pr) => pr.status === 'open'),
  broadcast: (key) => sendBroadcast(broadcastDeps, { ticketKey: key }),
  event: (key, kind, detail) => orchestratorService.recordEvent(key, kind, detail),
  now: () => new Date(),
});
